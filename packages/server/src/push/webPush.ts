import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createSign,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Web Push, written here rather than taken from a library: the two RFCs it
 * needs are an ECDH agreement, two HKDFs, one AES-GCM record and a signed
 * token, all of which `node:crypto` has, and the usual package brings an HTTP
 * client and a JWT stack along for them.
 *
 * - RFC 8291 (`encryptPayload`): the message is encrypted to the keys the
 *   browser made for its subscription, so the push service that carries it
 *   (Google's, Apple's, Mozilla's) cannot read it.
 * - RFC 8292 (`vapidAuthorization`): the request is signed with this server's
 *   own key, the one the browser was given when it subscribed, so the push
 *   service takes messages for that subscription from this server only.
 */

const b64url = (bytes: Buffer) => bytes.toString("base64url");
export const fromB64url = (text: string) => Buffer.from(text, "base64url");

/** An uncompressed P-256 point: 0x04, then X and Y. */
const POINT_BYTES = 65;
/** The largest record this writes; one record holds any message sent here. */
const RECORD_SIZE = 4096;
/** What a push service takes at most, by the RFC: 4096 bytes, less the
 * header and the tag. */
export const MAX_PAYLOAD_BYTES = 3900;

/** This server's signing key for push, as it is stored. */
export interface VapidKeys {
  /** The uncompressed point, base64url: what a browser subscribes with. */
  publicKey: string;
  /** The private scalar, base64url. */
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: b64url(ecdh.getPublicKey()),
    privateKey: b64url(ecdh.getPrivateKey()),
  };
}

/** What a browser hands over when it subscribes, as `PushSubscription.toJSON`
 * gives it. */
export interface PushTarget {
  endpoint: string;
  /** The subscription's public key, an uncompressed P-256 point. */
  p256dh: string;
  /** Its 16 byte authentication secret. */
  auth: string;
}

/** Whether the keys are the size they must be, before anything is derived. */
export function isUsableTarget(target: Pick<PushTarget, "p256dh" | "auth">) {
  const point = fromB64url(target.p256dh);
  return (
    point.length === POINT_BYTES &&
    point[0] === 0x04 &&
    fromB64url(target.auth).length === 16
  );
}

/**
 * The body of a push request: `plaintext` encrypted for one subscription
 * (RFC 8291, `aes128gcm`). The sender's key pair and the salt are made fresh
 * for each message; they are parameters only so the RFC's own example can be
 * reproduced in a test.
 */
export function encryptPayload(
  plaintext: Buffer,
  target: Pick<PushTarget, "p256dh" | "auth">,
  fresh: { privateKey?: Buffer; salt?: Buffer } = {},
): Buffer {
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new Error("Push payload too large");
  }
  const receiverPublic = fromB64url(target.p256dh);
  const authSecret = fromB64url(target.auth);

  const sender = createECDH("prime256v1");
  if (fresh.privateKey) sender.setPrivateKey(fresh.privateKey);
  else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const shared = sender.computeSecret(receiverPublic);

  // The input keying material binds both public keys and the auth secret,
  // so nothing but this subscription can derive the content key.
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    receiverPublic,
    senderPublic,
  ]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));

  const salt = fresh.salt ?? randomBytes(16);
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

  // One record, and the last: the 0x02 after the text says so.
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const record = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, record]);
}

/**
 * The `Authorization` header of a push request (RFC 8292): a token signed
 * with this server's key, good for the push service at `endpoint`'s origin
 * and for twelve hours, naming `subject` as who to contact about it.
 */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now: number = Date.now(),
): string {
  const segment = (value: object) => b64url(Buffer.from(JSON.stringify(value)));
  const unsigned = `${segment({ typ: "JWT", alg: "ES256" })}.${segment({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: subject,
  })}`;
  const publicPoint = fromB64url(keys.publicKey);
  const key = createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: b64url(publicPoint.subarray(1, 33)),
      y: b64url(publicPoint.subarray(33, 65)),
    },
  });
  // The raw R and S, as a JWT carries them, not the DER a certificate would.
  const signature = createSign("SHA256")
    .update(unsigned)
    .sign({ key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`;
}
