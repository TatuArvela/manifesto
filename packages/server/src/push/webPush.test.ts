import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  createVerify,
  hkdfSync,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  encryptPayload,
  fromB64url,
  generateVapidKeys,
  isUsableTarget,
  vapidAuthorization,
} from "./webPush.js";

/** What a browser does with a push body: RFC 8291 from the receiving end. */
function decrypt(body: Buffer, receiverPrivate: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const senderPublic = body.subarray(21, 21 + keyLength);
  const record = body.subarray(21 + keyLength);
  const receiver = createECDH("prime256v1");
  receiver.setPrivateKey(receiverPrivate);
  const shared = receiver.computeSecret(senderPublic);
  const ikm = Buffer.from(
    hkdfSync(
      "sha256",
      shared,
      auth,
      Buffer.concat([
        Buffer.from("WebPush: info\0"),
        receiver.getPublicKey(),
        senderPublic,
      ]),
      32,
    ),
  );
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      ikm,
      salt,
      Buffer.from("Content-Encoding: aes128gcm\0"),
      16,
    ),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ]);
  expect(padded.at(-1)).toBe(0x02);
  return padded.subarray(0, -1).toString("utf8");
}

describe("Web Push encryption (RFC 8291)", () => {
  // Appendix A of the RFC, every value as printed there.
  const example = {
    plaintext: "When I grow up, I want to be a watermelon",
    senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    receiverPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
    receiverPublic:
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
    salt: "DGv6ra1nlYgDCS1FRnbzlw",
    body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  };

  it("produces the RFC's own example, byte for byte", () => {
    const body = encryptPayload(
      Buffer.from(example.plaintext),
      { p256dh: example.receiverPublic, auth: example.auth },
      {
        privateKey: fromB64url(example.senderPrivate),
        salt: fromB64url(example.salt),
      },
    );
    expect(body.toString("base64url")).toBe(example.body);
  });

  it("is read back by the subscription's own keys, and by no others", () => {
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const auth = Buffer.from("0123456789abcdef");
    const target = {
      p256dh: receiver.getPublicKey().toString("base64url"),
      auth: auth.toString("base64url"),
    };
    const message = JSON.stringify({ title: "Dentist", noteId: "01J" });
    const body = encryptPayload(Buffer.from(message), target);

    expect(decrypt(body, receiver.getPrivateKey(), auth)).toBe(message);
    // A fresh key and salt each time: the same message never looks the same.
    expect(encryptPayload(Buffer.from(message), target).equals(body)).toBe(
      false,
    );
    expect(() =>
      decrypt(body, receiver.getPrivateKey(), Buffer.from("fedcba9876543210")),
    ).toThrow();
  });

  it("refuses a message a push service would not carry", () => {
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const target = {
      p256dh: receiver.getPublicKey().toString("base64url"),
      auth: Buffer.alloc(16).toString("base64url"),
    };
    expect(() => encryptPayload(Buffer.alloc(5000), target)).toThrow();
  });

  it("tells a subscription's keys from something else", () => {
    const { publicKey } = generateVapidKeys();
    const auth = Buffer.alloc(16).toString("base64url");
    expect(isUsableTarget({ p256dh: publicKey, auth })).toBe(true);
    expect(isUsableTarget({ p256dh: "AAAA", auth })).toBe(false);
    expect(isUsableTarget({ p256dh: publicKey, auth: "AAAA" })).toBe(false);
  });
});

describe("the push request's signature (RFC 8292)", () => {
  it("is a token the server's public key verifies, for that push service", () => {
    const keys = generateVapidKeys();
    const now = Date.parse("2026-10-03T12:00:00Z");
    const header = vapidAuthorization(
      "https://push.example/send/abc123",
      keys,
      "https://notes.example",
      now,
    );
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(
      header,
    );
    expect(match).not.toBeNull();
    const [, head = "", claims = "", signature = "", k = ""] = match ?? [];
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(fromB64url(head).toString())).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(JSON.parse(fromB64url(claims).toString())).toEqual({
      aud: "https://push.example",
      exp: now / 1000 + 12 * 60 * 60,
      sub: "https://notes.example",
    });

    const point = fromB64url(keys.publicKey);
    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33, 65).toString("base64url"),
      },
    });
    const verifies = (signed: string) =>
      createVerify("SHA256")
        .update(signed)
        .verify(
          { key: publicKey, dsaEncoding: "ieee-p1363" },
          fromB64url(signature),
        );
    expect(fromB64url(signature)).toHaveLength(64);
    expect(verifies(`${head}.${claims}`)).toBe(true);
    expect(verifies(`${head}.${claims}x`)).toBe(false);
  });
});
