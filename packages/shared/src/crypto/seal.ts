import { CIPHERTEXT_PREFIX } from "#/api/keys.js";
import { base64urlToBytes, bytesToBase64url, fromUtf8, utf8 } from "./bytes.js";

/**
 * The one way anything is encrypted: AES-256-GCM, a random 96-bit nonce for
 * every value, and associated data that says where the value belongs, so a
 * ciphertext moved to another row, field, account or key version does not
 * open. Keys for each job come out of HKDF-SHA-256. Every primitive is
 * WebCrypto, which a browser has only on `https` pages and `localhost`, and
 * which the server uses for the requests a token makes.
 */

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BITS = 256;

/** How long the ciphertext of `plainBytes` bytes is, as text. */
export function sealedLength(plainBytes: number): number {
  return (
    CIPHERTEXT_PREFIX.length +
    Math.ceil(((NONCE_BYTES + plainBytes + TAG_BYTES) * 4) / 3)
  );
}

/** Whether this page can encrypt at all: not over plain `http`. */
export function cryptoAvailable(): boolean {
  return typeof crypto !== "undefined" && crypto.subtle !== undefined;
}

/**
 * What a ciphertext is bound to: the id of its row, the name of its field,
 * the version of the key it is under and, for what is one person's own, the
 * account. Joined with a character none of them contains.
 */
export function associatedData(parts: {
  id: string;
  field: string;
  version: number;
  account?: string;
}): Uint8Array<ArrayBuffer> {
  return utf8(
    [parts.id, parts.field, String(parts.version), parts.account ?? ""].join(
      "\n",
    ),
  );
}

/**
 * Encrypts `plaintext` under `key`, bound to `data`, as bytes: the nonce,
 * the ciphertext and its tag. For what is stored as bytes, an image.
 */
export async function sealBytes(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: data },
      key,
      plaintext,
    ),
  );
  const out = new Uint8Array(NONCE_BYTES + ciphertext.length);
  out.set(nonce);
  out.set(ciphertext, NONCE_BYTES);
  return out;
}

/** Decrypts what `sealBytes` made; null for anything that does not open. */
export async function unsealBytes(
  key: CryptoKey,
  sealed: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) return null;
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: sealed.subarray(0, NONCE_BYTES),
          additionalData: data,
        },
        key,
        sealed.subarray(NONCE_BYTES),
      ),
    );
  } catch {
    return null;
  }
}

/** Encrypts `plaintext` under `key`, bound to `data`. */
export async function seal(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<string> {
  return (
    CIPHERTEXT_PREFIX + bytesToBase64url(await sealBytes(key, plaintext, data))
  );
}

/**
 * Decrypts what `seal` made. Null for the wrong key, the wrong `data`, or
 * anything that is not a ciphertext: all of them are "this does not open",
 * and none is worth telling apart to whoever is trying.
 */
export async function unseal(
  key: CryptoKey,
  sealed: string,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof sealed !== "string" || !sealed.startsWith(CIPHERTEXT_PREFIX)) {
    return null;
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64urlToBytes(sealed.slice(CIPHERTEXT_PREFIX.length));
  } catch {
    return null;
  }
  return unsealBytes(key, bytes, data);
}

/** `unseal` read as UTF-8 text; null for nothing given, or for what does not
 * open or is not text. */
export async function unsealText(
  key: CryptoKey,
  sealed: string | null | undefined,
  data: Uint8Array<ArrayBuffer>,
): Promise<string | null> {
  if (!sealed) return null;
  const bytes = await unseal(key, sealed, data);
  return bytes ? fromUtf8(bytes) : null;
}

/**
 * Key material as something keys can be derived from and nothing can be read
 * out of: the page can use it, and a script that reaches it cannot export it.
 */
export function derivable(
  material: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", material, "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ]);
}

/** `purpose` names the job; every job gets a key of its own. */
function hkdf(purpose: string): HkdfParams {
  return {
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(0),
    info: utf8(`manifesto/v1/${purpose}`),
  };
}

/** The AES-256-GCM key for `purpose`, which cannot be read out either. */
export function deriveKey(
  base: CryptoKey,
  purpose: string,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    hkdf(purpose),
    base,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/** The HMAC-SHA-256 key for `purpose`, which cannot be read out either. */
export function deriveMacKey(
  base: CryptoKey,
  purpose: string,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    hkdf(purpose),
    base,
    { name: "HMAC", hash: "SHA-256", length: KEY_BITS },
    false,
    ["sign"],
  );
}

/** 256 bits for `purpose`, for a value that has to leave as bytes. */
export async function deriveBytes(
  base: CryptoKey,
  purpose: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await crypto.subtle.deriveBits(hkdf(purpose), base, KEY_BITS),
  );
}

/** Raw key bytes as an AES-256-GCM key that cannot be read back out. */
export function sealingKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
