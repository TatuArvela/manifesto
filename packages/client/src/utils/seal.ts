import { CIPHERTEXT_PREFIX } from "@manifesto/shared";
import { base64urlToBytes, bytesToBase64url } from "./webauthn.js";

/**
 * The one way anything is encrypted here: AES-256-GCM, a random 96-bit nonce
 * for every value, and associated data that says where the value belongs, so
 * a ciphertext moved to another row, field, account or key version does not
 * open. Keys for each job come out of HKDF-SHA-256. Every primitive is the
 * browser's own WebCrypto, which exists only on `https` pages and `localhost`.
 */

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BITS = 256;

const encoder = new TextEncoder();

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
  return encoder.encode(
    [parts.id, parts.field, String(parts.version), parts.account ?? ""].join(
      "\n",
    ),
  );
}

/** Encrypts `plaintext` under `key`, bound to `data`. */
export async function seal(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<string> {
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
  return CIPHERTEXT_PREFIX + bytesToBase64url(out);
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
  if (!sealed.startsWith(CIPHERTEXT_PREFIX)) return null;
  try {
    const bytes = base64urlToBytes(sealed.slice(CIPHERTEXT_PREFIX.length));
    if (bytes.length < NONCE_BYTES + TAG_BYTES) return null;
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: bytes.subarray(0, NONCE_BYTES),
          additionalData: data,
        },
        key,
        bytes.subarray(NONCE_BYTES),
      ),
    );
  } catch {
    return null;
  }
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
    info: encoder.encode(`manifesto/v1/${purpose}`),
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

/** 256 bits for `purpose`, for a value that has to leave as bytes. */
export async function deriveBytes(
  base: CryptoKey,
  purpose: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await crypto.subtle.deriveBits(hkdf(purpose), base, KEY_BITS),
  );
}
