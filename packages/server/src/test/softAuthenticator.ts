import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import type {
  PasskeyAuthenticationResponse,
  PasskeyCreationOptions,
  PasskeyRegistrationResponse,
  PasskeyRequestOptions,
} from "@manifesto/shared";

/**
 * A passkey in software, for tests: it makes a P-256 credential and signs
 * challenges with it, producing exactly what a browser would hand the page,
 * so the server's WebAuthn checks run against real signatures.
 */

type Cbor = number | Uint8Array | string | CborMap | CborRecord;
interface CborMap extends Map<Cbor, Cbor> {}
interface CborRecord {
  [key: string]: Cbor;
}

function head(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length];
  if (length < 256) return [(major << 5) | 24, length];
  if (length < 65536) return [(major << 5) | 25, length >> 8, length & 0xff];
  throw new Error("too long for this encoder");
}

/** Just enough CBOR: small integers, byte and text strings, maps. */
function cbor(value: Cbor): Uint8Array {
  if (typeof value === "number") {
    return Uint8Array.from(value >= 0 ? head(0, value) : head(1, -1 - value));
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return Buffer.concat([Uint8Array.from(head(3, bytes.length)), bytes]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([Uint8Array.from(head(2, value.length)), value]);
  }
  const entries =
    value instanceof Map ? [...value.entries()] : Object.entries(value);
  return Buffer.concat([
    Uint8Array.from(head(5, entries.length)),
    ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)]),
  ]);
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest();

const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;

export function createSoftAuthenticator(origin: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const credentialId = randomBytes(16);
  let counter = 0;
  let userHandle: string | undefined;

  function clientData(type: string, challenge: string) {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin, crossOrigin: false }),
    );
  }

  return {
    credentialId: b64url(credentialId),
    /** What `navigator.credentials.create()` would answer. */
    create(options: PasskeyCreationOptions): PasskeyRegistrationResponse {
      userHandle = options.user.id;
      const rpId = options.rp.id ?? new URL(origin).hostname;
      const cose = cbor(
        new Map<Cbor, Cbor>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x as string, "base64url")],
          [-3, Buffer.from(jwk.y as string, "base64url")],
        ]),
      );
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(credentialId.length);
      const authData = Buffer.concat([
        sha256(rpId),
        Uint8Array.from([UP | UV | BE | BS | AT]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        idLength,
        credentialId,
        cose,
      ]);
      const attestationObject = cbor({
        fmt: "none",
        attStmt: new Map(),
        authData,
      });
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64url(
            clientData("webauthn.create", options.challenge),
          ),
          attestationObject: b64url(attestationObject),
          transports: ["internal"],
        },
        clientExtensionResults: {},
      };
    },
    /** What `navigator.credentials.get()` would answer. `verified: false`
     * leaves out the user-verification flag, as a key without a PIN does. */
    get(
      options: PasskeyRequestOptions,
      { verified = true }: { verified?: boolean } = {},
    ): PasskeyAuthenticationResponse {
      counter += 1;
      const rpId = options.rpId ?? new URL(origin).hostname;
      const count = Buffer.alloc(4);
      count.writeUInt32BE(counter);
      const authData = Buffer.concat([
        sha256(rpId),
        Uint8Array.from([UP | (verified ? UV : 0) | BE | BS]),
        count,
      ]);
      const data = clientData("webauthn.get", options.challenge);
      const signature = sign(
        "sha256",
        Buffer.concat([authData, sha256(data)]),
        privateKey,
      );
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: "public-key",
        response: {
          clientDataJSON: b64url(data),
          authenticatorData: b64url(authData),
          signature: b64url(signature),
          ...(userHandle !== undefined && { userHandle }),
        },
        clientExtensionResults: {},
      };
    },
  };
}
