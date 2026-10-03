import {
  createDecipheriv,
  createECDH,
  type ECDH,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * The receiving end of Web Push, for tests: a browser's subscription keys,
 * and a push service on loopback that keeps what it is sent. RFC 8291 from
 * the side the server never implements, so the two are written independently.
 */

export interface TestSubscription {
  p256dh: string;
  auth: string;
  /** Reads a push body encrypted to this subscription. */
  decrypt(body: Buffer): string;
}

export function newTestSubscription(): TestSubscription {
  const keys: ECDH = createECDH("prime256v1");
  keys.generateKeys();
  const auth = randomBytes(16);
  return {
    p256dh: keys.getPublicKey().toString("base64url"),
    auth: auth.toString("base64url"),
    decrypt(body) {
      const salt = body.subarray(0, 16);
      const keyLength = body.readUInt8(20);
      const senderPublic = body.subarray(21, 21 + keyLength);
      const record = body.subarray(21 + keyLength);
      const shared = keys.computeSecret(senderPublic);
      const ikm = Buffer.from(
        hkdfSync(
          "sha256",
          shared,
          auth,
          Buffer.concat([
            Buffer.from("WebPush: info\0"),
            keys.getPublicKey(),
            senderPublic,
          ]),
          32,
        ),
      );
      const derive = (label: string, length: number) =>
        Buffer.from(
          hkdfSync(
            "sha256",
            ikm,
            salt,
            Buffer.from(`Content-Encoding: ${label}\0`),
            length,
          ),
        );
      const decipher = createDecipheriv(
        "aes-128-gcm",
        derive("aes128gcm", 16),
        derive("nonce", 12),
      );
      decipher.setAuthTag(record.subarray(record.length - 16));
      const padded = Buffer.concat([
        decipher.update(record.subarray(0, record.length - 16)),
        decipher.final(),
      ]);
      if (padded.at(-1) !== 0x02) throw new Error("Not a final record");
      return padded.subarray(0, -1).toString("utf8");
    },
  };
}

export interface TestPushService {
  /** The endpoint a subscription at `path` would have. */
  endpoint(path: string): string;
  received: { path: string; headers: IncomingHttpHeaders; body: Buffer }[];
  /** What the service answers with; 201 unless a test says otherwise. */
  status: number;
  close(): Promise<void>;
}

export async function startTestPushService(): Promise<TestPushService> {
  const service: TestPushService = {
    endpoint: () => "",
    received: [],
    status: 201,
    close: async () => {},
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      service.received.push({
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      res.statusCode = service.status;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  service.endpoint = (path) => `http://127.0.0.1:${port}/${path}`;
  service.close = () =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return service;
}
