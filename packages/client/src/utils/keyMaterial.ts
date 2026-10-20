import {
  type AccountKeys,
  type AccountKeysSetupRequest,
  associatedData,
  bytesToBase64url,
  derivable,
  deriveBytes,
  deriveKey,
  deriveMacKey,
  type ImageKeySource,
  type RecoveryKeyWrap,
  seal,
  unseal,
} from "@manifesto/shared";
import { newUserKey } from "./userKey.ts";

/**
 * The keys of an account, made and wrapped in the browser
 * (`docs/specification/features/encryption.md`, "Keys" and "Unlocking").
 *
 * The account key is 256 random bits that encrypt nothing themselves. A key for
 * each job is derived from it. It goes out of this module only in two shapes:
 * wrapped, for the server to keep, and as a `CryptoKey` that derives and cannot
 * be read out, for the device to keep. The raw bytes exist only while a
 * function here runs, and are overwritten before it returns.
 */

const ACCOUNT_KEY_BYTES = 32;

/** The jobs for which a key is derived from the account key. */
export type AccountKeyPurpose =
  | "notes"
  | "personal"
  | "reminder"
  | "private-keys"
  | "images"
  | "offline"
  | "drafts";

/** The key derived from the account key for `purpose`. */
export function accountSubkey(
  accountKey: CryptoKey,
  purpose: AccountKeyPurpose,
): Promise<CryptoKey> {
  return deriveKey(accountKey, `account/${purpose}`);
}

/**
 * The two keys of the account for images. One makes the key of an image from
 * its bytes. The other makes the address under which the image is stored. Thus,
 * the same image attached two times by one account is stored one time.
 */
export async function accountImageKeys(
  accountKey: CryptoKey,
): Promise<ImageKeySource> {
  return {
    derive: await deriveMacKey(accountKey, "account/images/key"),
    address: await deriveMacKey(accountKey, "account/images/address"),
  };
}

const encoder = new TextEncoder();

/** What a secret key or recovery key wraps the account key with. */
async function userKeyWrap(
  userKey: string,
  kind: "secret" | "recovery",
): Promise<CryptoKey> {
  return deriveKey(
    await derivable(encoder.encode(userKey)),
    `${kind}-key/wrap`,
  );
}

function wrapData(
  userId: string,
  version: number,
  kind: "secret" | "recovery",
): Uint8Array<ArrayBuffer> {
  return associatedData({
    id: userId,
    field: `account-key/${kind}`,
    version,
    account: userId,
  });
}

/**
 * What the recovery key proves itself to the server with. Derived separately
 * from the key that wraps. Thus, the hash that the server has tells nothing
 * about it.
 */
export async function recoveryVerifierOf(recoveryKey: string): Promise<string> {
  const base = await derivable(encoder.encode(recoveryKey));
  return bytesToBase64url(await deriveBytes(base, "recovery-key/verifier"));
}

/** Overwrites key bytes that are no longer necessary. */
function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}

async function wrapUnderSecret(
  raw: Uint8Array<ArrayBuffer>,
  userId: string,
  version: number,
  secretKey: string,
): Promise<string> {
  return seal(
    await userKeyWrap(secretKey, "secret"),
    raw,
    wrapData(userId, version, "secret"),
  );
}

async function wrapUnderRecovery(
  raw: Uint8Array<ArrayBuffer>,
  userId: string,
  version: number,
  recoveryKey: string,
): Promise<RecoveryKeyWrap> {
  return {
    wrappedByRecovery: await seal(
      await userKeyWrap(recoveryKey, "recovery"),
      raw,
      wrapData(userId, version, "recovery"),
    ),
    recoveryVerifier: await recoveryVerifierOf(recoveryKey),
  };
}

/**
 * A P-256 pair as the server keeps it: the public half as it is, and the
 * private half wrapped under the key of the account for private keys.
 */
async function newKeyPair(
  algorithm: "ECDH" | "ECDSA",
  field: "exchange" | "signing",
  wrappingKey: CryptoKey,
  userId: string,
  version: number,
): Promise<{ publicKey: string; wrappedPrivateKey: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: algorithm, namedCurve: "P-256" },
    true,
    algorithm === "ECDH" ? ["deriveBits"] : ["sign", "verify"],
  );
  const privateKey = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  try {
    return {
      publicKey: bytesToBase64url(
        await crypto.subtle.exportKey("raw", pair.publicKey),
      ),
      wrappedPrivateKey: await seal(
        wrappingKey,
        privateKey,
        associatedData({
          id: userId,
          field: `private-key/${field}`,
          version,
          account: userId,
        }),
      ),
    };
  } finally {
    wipe(privateKey);
  }
}

/** All that a new account gets, and what it sends the server. */
export interface NewAccountKeys {
  secretKey: string;
  recoveryKey: string;
  /** For the device to keep. See the note at the top. */
  accountKey: CryptoKey;
  version: number;
  request: AccountKeysSetupRequest;
}

/**
 * The first keys of account `userId`: an account key, the secret key and the
 * recovery key that each wrap it, and its two key pairs.
 */
export async function createAccountKeys(
  userId: string,
): Promise<NewAccountKeys> {
  const version = 1;
  const raw = crypto.getRandomValues(new Uint8Array(ACCOUNT_KEY_BYTES));
  try {
    const secretKey = newUserKey("secret");
    const recoveryKey = newUserKey("recovery");
    const accountKey = await derivable(raw);
    const forPrivateKeys = await accountSubkey(accountKey, "private-keys");
    const exchange = await newKeyPair(
      "ECDH",
      "exchange",
      forPrivateKeys,
      userId,
      version,
    );
    const signing = await newKeyPair(
      "ECDSA",
      "signing",
      forPrivateKeys,
      userId,
      version,
    );
    return {
      secretKey,
      recoveryKey,
      accountKey,
      version,
      request: {
        wrappedBySecret: await wrapUnderSecret(raw, userId, version, secretKey),
        ...(await wrapUnderRecovery(raw, userId, version, recoveryKey)),
        publicKeys: {
          exchange: exchange.publicKey,
          signing: signing.publicKey,
        },
        wrappedPrivateKeys: {
          exchange: exchange.wrappedPrivateKey,
          signing: signing.wrappedPrivateKey,
        },
      },
    };
  } finally {
    wipe(raw);
  }
}

type SecretWrap = Pick<AccountKeys, "version" | "wrappedBySecret">;

/**
 * Runs `use` on the bytes of the account key, opened with the secret key and
 * overwritten after that. Null when that is not the key under which they are
 * wrapped.
 */
async function withAccountKey<T>(
  userId: string,
  keys: SecretWrap,
  secretKey: string,
  use: (raw: Uint8Array<ArrayBuffer>) => Promise<T>,
): Promise<T | null> {
  const raw = await unseal(
    await userKeyWrap(secretKey, "secret"),
    keys.wrappedBySecret,
    wrapData(userId, keys.version, "secret"),
  );
  if (!raw) return null;
  try {
    return await use(raw);
  } finally {
    wipe(raw);
  }
}

/**
 * The account key of `userId`, opened with the secret key, or null when that is
 * not the key under which it is wrapped.
 */
export function unlockAccountKey(
  userId: string,
  keys: SecretWrap,
  secretKey: string,
): Promise<CryptoKey | null> {
  return withAccountKey(userId, keys, secretKey, derivable);
}

/** A new secret key for the same account key, and its wrap. */
export interface NewSecretKey {
  secretKey: string;
  wrappedBySecret: string;
}

/** A new recovery key for the same account key, and its wrap. */
export interface NewRecoveryKey extends RecoveryKeyWrap {
  recoveryKey: string;
}

/**
 * A new secret key in place of `secretKey`, which must open the account key
 * first. A new wrap needs the key itself, and the device has only a form of it
 * that cannot be read out. Null when `secretKey` is not current.
 */
export function replaceSecretKey(
  userId: string,
  keys: SecretWrap,
  secretKey: string,
): Promise<NewSecretKey | null> {
  return withAccountKey(userId, keys, secretKey, async (raw) => {
    const next = newUserKey("secret");
    return {
      secretKey: next,
      wrappedBySecret: await wrapUnderSecret(raw, userId, keys.version, next),
    };
  });
}

/** A new recovery key, opened in the same way. Null as above. */
export function replaceRecoveryKey(
  userId: string,
  keys: SecretWrap,
  secretKey: string,
): Promise<NewRecoveryKey | null> {
  return withAccountKey(userId, keys, secretKey, async (raw) => {
    const recoveryKey = newUserKey("recovery");
    return {
      recoveryKey,
      ...(await wrapUnderRecovery(raw, userId, keys.version, recoveryKey)),
    };
  });
}

/**
 * What the use of the recovery key gives: the account key for the device, and a
 * new secret key and recovery key in place of those that the account had.
 */
export interface RecoveredKeys extends NewSecretKey, NewRecoveryKey {
  accountKey: CryptoKey;
  version: number;
}

/**
 * Opens the account key with the recovery key, and makes new copies of both
 * keys that a person keeps, because the holder of the old keys must open
 * nothing after this. Null when `recoveryKey` is not the key of the account.
 */
export async function recoverAccountKey(
  opened: { userId: string; version: number; wrappedByRecovery: string },
  recoveryKey: string,
): Promise<RecoveredKeys | null> {
  const { userId, version } = opened;
  const raw = await unseal(
    await userKeyWrap(recoveryKey, "recovery"),
    opened.wrappedByRecovery,
    wrapData(userId, version, "recovery"),
  );
  if (!raw) return null;
  try {
    const secretKey = newUserKey("secret");
    const nextRecoveryKey = newUserKey("recovery");
    return {
      accountKey: await derivable(raw),
      version,
      secretKey,
      wrappedBySecret: await wrapUnderSecret(raw, userId, version, secretKey),
      recoveryKey: nextRecoveryKey,
      ...(await wrapUnderRecovery(raw, userId, version, nextRecoveryKey)),
    };
  } finally {
    wipe(raw);
  }
}

/**
 * The private half of one of the key pairs of the account, opened with the
 * account key. Null when it does not open.
 */
export async function openPrivateKey(
  accountKey: CryptoKey,
  userId: string,
  keys: Pick<AccountKeys, "version" | "wrappedPrivateKeys">,
  field: "exchange" | "signing",
): Promise<CryptoKey | null> {
  const pkcs8 = await unseal(
    await accountSubkey(accountKey, "private-keys"),
    keys.wrappedPrivateKeys[field],
    associatedData({
      id: userId,
      field: `private-key/${field}`,
      version: keys.version,
      account: userId,
    }),
  );
  if (!pkcs8) return null;
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: field === "exchange" ? "ECDH" : "ECDSA", namedCurve: "P-256" },
      false,
      field === "exchange" ? ["deriveBits"] : ["sign"],
    );
  } catch {
    return null;
  } finally {
    wipe(pkcs8);
  }
}
