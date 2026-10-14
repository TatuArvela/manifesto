// The keys an account's notes are encrypted with, as the server stores them:
// wrapped, so that nothing here opens a note. See
// `docs/specification/features/encryption.md`.

/**
 * What every encrypted value looks like on the wire and at rest: `e1.` and
 * the base64url of a 96-bit nonce, the AES-256-GCM ciphertext and its tag.
 * The server checks this shape and nothing else, since it holds no key.
 */
export const CIPHERTEXT_PREFIX = "e1.";

/** A nonce and a tag with nothing between them, as base64url. */
const MIN_CIPHERTEXT_CHARS = 38;

/** The longest wrapped key an account stores (a wrapped PKCS#8 private key
 * is about 230 characters). */
export const MAX_WRAPPED_KEY_LENGTH = 1024;

/**
 * Whether `value` is shaped as a ciphertext no longer than `maxLength`. A
 * linear scan rather than a pattern, so the length of what a caller sends
 * decides nothing but how long the scan takes.
 */
export function isCiphertext(value: unknown, maxLength: number): boolean {
  if (typeof value !== "string") return false;
  if (value.length > maxLength) return false;
  if (!value.startsWith(CIPHERTEXT_PREFIX)) return false;
  const body = value.slice(CIPHERTEXT_PREFIX.length);
  if (body.length < MIN_CIPHERTEXT_CHARS) return false;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    const ok =
      (c >= 48 && c <= 57) || // 0-9
      (c >= 65 && c <= 90) || // A-Z
      (c >= 97 && c <= 122) || // a-z
      c === 45 || // -
      c === 95; // _
    if (!ok) return false;
  }
  return true;
}

/** An uncompressed P-256 point (65 bytes) as base64url. */
export const PUBLIC_KEY_LENGTH = 87;

/** What the recovery key proves itself to the server with: 32 bytes derived
 * from it in the browser, as base64url. The server keeps only its hash. */
export const RECOVERY_VERIFIER_LENGTH = 43;

/** An account's two public keys, which other accounts share with. */
export interface AccountPublicKeys {
  /** ECDH: note keys are wrapped to it. */
  exchange: string;
  /** ECDSA: what the account wraps for others, it signs with this one. */
  signing: string;
}

/** The private halves, each wrapped under the account key. */
export interface WrappedPrivateKeys {
  exchange: string;
  signing: string;
}

/** What a signed-in device is given to unlock with. */
export interface AccountKeys {
  /** Which account key this is; it goes up when every key is replaced. */
  version: number;
  /** The account key, wrapped under a key derived from the secret key. */
  wrappedBySecret: string;
  publicKeys: AccountPublicKeys;
  wrappedPrivateKeys: WrappedPrivateKeys;
}

/** `GET /api/auth/keys`. */
export interface AccountKeysResponse {
  /** Null for an account that has not been set up yet. */
  keys: AccountKeys | null;
  /**
   * When this session ends at the latest, however much it is used. A device
   * removes its keys by itself once this has passed, since one that was off
   * never heard the session end.
   */
  sessionEndsAt: string;
}

/** The recovery key's half of an account's keys. */
export interface RecoveryKeyWrap {
  /** The account key, wrapped under a key derived from the recovery key. */
  wrappedByRecovery: string;
  recoveryVerifier: string;
}

/** `PUT /api/auth/keys`: an account's first keys, made in the browser. */
export interface AccountKeysSetupRequest extends RecoveryKeyWrap {
  wrappedBySecret: string;
  publicKeys: AccountPublicKeys;
  wrappedPrivateKeys: WrappedPrivateKeys;
}

/** `POST /api/auth/keys/secret`: a new secret key, with the password. */
export interface SecretKeyReplaceRequest {
  password?: string;
  wrappedBySecret: string;
}

/** `POST /api/auth/keys/recovery`: a new recovery key, with the password. */
export interface RecoveryKeyReplaceRequest extends RecoveryKeyWrap {
  password?: string;
}

/** `POST /api/auth/keys/recover`, and `POST /api/auth/recovery` with the
 * username beside it: the first step of using the recovery key. */
export interface RecoveryOpenRequest {
  verifier: string;
}

/** The wrapped account key, handed to whoever holds the recovery key. */
export interface RecoveryOpenResponse {
  /** Whose keys they are: it is part of what each wrap is bound to. */
  userId: string;
  version: number;
  wrappedByRecovery: string;
  /** Whether the account signs in with a password, which the recovery then
   * has to replace. */
  hasPassword: boolean;
}

/**
 * `POST /api/auth/keys/recover/complete`, and `POST /api/auth/recovery/complete`
 * with the username and a new password beside it: the second step, which puts
 * a new secret key and a new recovery key in place of the ones used.
 */
export interface RecoveryCompleteRequest extends RecoveryKeyWrap {
  verifier: string;
  wrappedBySecret: string;
}
