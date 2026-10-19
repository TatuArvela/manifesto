// The keys with which the notes of an account are encrypted, as the server
// stores them: wrapped. Thus, nothing here opens a note. See
// `docs/specification/features/encryption.md`.

/**
 * The shape of each encrypted value on the wire and at rest: `e1.` and the
 * base64url of a 96-bit nonce, the AES-256-GCM ciphertext and its tag. The
 * server checks this shape and nothing else, because it has no key.
 */
export const CIPHERTEXT_PREFIX = "e1.";

/** A nonce and a tag with nothing between them, as base64url. */
const MIN_CIPHERTEXT_CHARS = 38;

/**
 * The longest wrapped key that an account stores (a wrapped PKCS#8 private key
 * is approximately 230 characters).
 */
export const MAX_WRAPPED_KEY_LENGTH = 1024;

/**
 * If `value` has the shape of a ciphertext no longer than `maxLength`. It is a
 * linear scan, not a pattern. Thus, the length of the input controls only the
 * duration of the scan.
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

/**
 * With this, the recovery key proves itself to the server: 32 bytes derived
 * from it in the browser, as base64url. The server keeps only its hash.
 */
export const RECOVERY_VERIFIER_LENGTH = 43;

/** The two public keys of an account, which other accounts use to share. */
export interface AccountPublicKeys {
  /** ECDH: note keys are wrapped to it. */
  exchange: string;
  /** ECDSA: the account signs what it wraps for others with this key. */
  signing: string;
}

/** The private halves, each wrapped under the account key. */
export interface WrappedPrivateKeys {
  exchange: string;
  signing: string;
}

/** What a signed-in device gets to unlock with. */
export interface AccountKeys {
  /** The account key that this is. It increases when all keys are replaced. */
  version: number;
  /** The account key, wrapped under a key derived from the secret key. */
  wrappedBySecret: string;
  publicKeys: AccountPublicKeys;
  wrappedPrivateKeys: WrappedPrivateKeys;
}

/** `GET /api/v1/auth/keys`. */
export interface AccountKeysResponse {
  /** Null for an account that is not set up yet. */
  keys: AccountKeys | null;
  /**
   * The latest possible end of this session, whatever its use. After this time,
   * a device removes its keys itself, because a device that was off never heard
   * that the session ended.
   */
  sessionEndsAt: string;
}

/** The part of the keys of an account for the recovery key. */
export interface RecoveryKeyWrap {
  /** The account key, wrapped under a key derived from the recovery key. */
  wrappedByRecovery: string;
  recoveryVerifier: string;
}

/**
 * `PUT /api/v1/auth/keys`: the first keys of an account, made in the browser.
 */
export interface AccountKeysSetupRequest extends RecoveryKeyWrap {
  wrappedBySecret: string;
  publicKeys: AccountPublicKeys;
  wrappedPrivateKeys: WrappedPrivateKeys;
}

/** `POST /api/v1/auth/keys/secret`: a new secret key, with the password. */
export interface SecretKeyReplaceRequest {
  password?: string;
  wrappedBySecret: string;
}

/** `POST /api/v1/auth/keys/recovery`: a new recovery key, with the password. */
export interface RecoveryKeyReplaceRequest extends RecoveryKeyWrap {
  password?: string;
}

/**
 * `POST /api/v1/auth/keys/recover`, and `POST /api/v1/auth/recovery` with the
 * username: the first step to use the recovery key.
 */
export interface RecoveryOpenRequest {
  verifier: string;
}

/** The wrapped account key, for the person who has the recovery key. */
export interface RecoveryOpenResponse {
  /** The owner of the keys. This is part of what each wrap is bound to. */
  userId: string;
  version: number;
  wrappedByRecovery: string;
  /**
   * If the account signs in with a password. The recovery must then replace it.
   */
  hasPassword: boolean;
}

/**
 * `POST /api/v1/auth/keys/recover/complete`, and `POST
 * /api/v1/auth/recovery/complete` with the username and a new password: the
 * second step. It puts a new secret key and a new recovery key in place of the
 * used keys.
 */
export interface RecoveryCompleteRequest extends RecoveryKeyWrap {
  verifier: string;
  wrappedBySecret: string;
}
