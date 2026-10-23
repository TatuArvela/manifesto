import type { DeviceSignInKey } from "#/api/auth.ts";
import {
  base64urlToBytes,
  bytesToBase64url,
  fromUtf8,
  utf8,
  wipe,
} from "./bytes.ts";
import { associatedData, derivable, deriveKey, seal, unseal } from "./seal.ts";

/**
 * How the secret key goes to a new device that signs in by a QR code
 * (`docs/specification/features/accounts.md`, "Signing in a new device").
 *
 * The new device makes an ECDH key pair for the one request, and puts its
 * public half in the code, next to the id of the request. The approving device
 * reads both from the code, never from the server. It wraps the secret key to
 * that public key through an ephemeral key of its own, bound to the id. The
 * server only carries the wrap from one device to the other.
 *
 * Both devices also show a short code made from the same two values. The
 * approving person types the code from the other screen. Thus, the approval
 * goes to the screen in front of them, and a code that a different person sent
 * them does not pass without that person also sending the matching code.
 */

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

/** The key pair of a new device for one request. */
export interface DeviceRequestKeys {
  privateKey: CryptoKey;
  /** The public half, base64url, for the QR code. */
  publicKey: string;
}

export async function newDeviceRequestKeys(): Promise<DeviceRequestKeys> {
  const pair = await crypto.subtle.generateKey(P256, false, ["deriveBits"]);
  return {
    privateKey: pair.privateKey,
    publicKey: bytesToBase64url(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    ),
  };
}

async function wrapKeyFor(
  privateKey: CryptoKey,
  otherPublic: string,
): Promise<CryptoKey> {
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "ECDH",
        public: await crypto.subtle.importKey(
          "raw",
          base64urlToBytes(otherPublic),
          P256,
          false,
          [],
        ),
      },
      privateKey,
      256,
    ),
  );
  try {
    return await deriveKey(await derivable(shared), "device-sign-in/wrap");
  } finally {
    wipe(shared);
  }
}

const requestData = (requestId: string) =>
  associatedData({ id: requestId, field: "device-sign-in", version: 1 });

/**
 * Wraps `secretKey` for the new device of `requestId`. Throws when
 * `devicePublicKey` is not a P-256 point.
 */
export async function wrapForDevice(
  requestId: string,
  devicePublicKey: string,
  secretKey: string,
): Promise<DeviceSignInKey> {
  const pair = await crypto.subtle.generateKey(P256, false, ["deriveBits"]);
  const wrapKey = await wrapKeyFor(pair.privateKey, devicePublicKey);
  return {
    ephemeral: bytesToBase64url(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    ),
    wrapped: await seal(wrapKey, utf8(secretKey), requestData(requestId)),
  };
}

/** The secret key from a wrap, on the new device. Null when it does not open. */
export async function openOnDevice(
  requestId: string,
  privateKey: CryptoKey,
  key: DeviceSignInKey,
): Promise<string | null> {
  try {
    const wrapKey = await wrapKeyFor(privateKey, key.ephemeral);
    const bytes = await unseal(wrapKey, key.wrapped, requestData(requestId));
    if (!bytes) return null;
    try {
      return fromUtf8(bytes);
    } finally {
      wipe(bytes);
    }
  } catch {
    return null;
  }
}

/**
 * The six digits that both screens show for a request, as `123 456`. They come
 * from the id and the public key in the QR code. Thus, the server cannot change
 * them.
 */
export async function deviceMatchCode(
  requestId: string,
  devicePublicKey: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      utf8(`manifesto/v1/device-sign-in\n${requestId}\n${devicePublicKey}`),
    ),
  );
  const value =
    (((digest[0] ?? 0) << 24) |
      ((digest[1] ?? 0) << 16) |
      ((digest[2] ?? 0) << 8) |
      (digest[3] ?? 0)) >>>
    0;
  const digits = String(value % 1_000_000).padStart(6, "0");
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}
