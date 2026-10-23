import type { Passkey } from "@manifesto/shared";

// What secures a sign-in in addition to the password: two-factor, passkeys,
// reset links, and the wrapped keys with which an account unlocks its notes.

export interface TotpState {
  secret: string;
  /** Null while it is set up, but not yet confirmed with a code. */
  enabledAt: string | null;
  lastStep: number;
}

/** Two-factor sign-in (TOTP) for local accounts. */
export interface TwoFactorRepo {
  get(userId: string): Promise<TotpState | null>;
  /**
   * Starts (or starts again) a setup with a new secret, not confirmed. Refused
   * (false) while two-factor is on. The user must turn that off first.
   */
  begin(userId: string, secret: string, at: string): Promise<boolean>;
  /** Confirms a setup, and records the step of the code that confirmed it. */
  enable(userId: string, at: string, step: number): Promise<void>;
  /** Removes the authenticator. */
  disable(userId: string): Promise<void>;
  /**
   * Records `step` as used if it is later than the last step, atomically, and
   * tells if it was. False is a code that was used before. Refuse it.
   */
  advanceStep(userId: string, step: number): Promise<boolean>;
}

/**
 * The keys of an account as the server keeps them: the account key wrapped two
 * times (under the secret key and under the recovery key), the public halves of
 * its two key pairs, and the wrapped private halves. None of it opens anything
 * without a key that the server never gets.
 */
export interface StoredAccountKeys {
  userId: string;
  version: number;
  wrappedBySecret: string;
  wrappedByRecovery: string;
  /** The SHA-256 of the value with which the recovery key proves itself. */
  recoveryVerifierHash: string;
  exchangePublicKey: string;
  signingPublicKey: string;
  wrappedExchangePrivateKey: string;
  wrappedSigningPrivateKey: string;
  createdAt: string;
  updatedAt: string;
}

/** What a used recovery key leaves in its place. */
export interface ReplacementUserKeys {
  wrappedBySecret: string;
  wrappedByRecovery: string;
  recoveryVerifierHash: string;
}

export interface AccountKeysRepo {
  get(userId: string): Promise<StoredAccountKeys | null>;
  /**
   * The keys that an account saw of other accounts, sealed, by the id of the
   * other account.
   */
  seenKeys(userId: string): Promise<Record<string, string>>;
  /**
   * Remembers one, over the previous value for that account. False, with
   * nothing written, when it would be one more than `max`.
   */
  rememberKey(
    userId: string,
    peerId: string,
    sealed: string,
    at: string,
    max: number,
  ): Promise<boolean>;
  /**
   * Stores the first keys of an account. False, with nothing written, when it
   * already has keys. Two devices that set up at the same time must not each
   * think that their keys were kept.
   */
  create(keys: StoredAccountKeys): Promise<boolean>;
  /**
   * Puts the wrap of a new secret key in place. False for an account without
   * keys.
   */
  setSecretWrap(
    userId: string,
    wrappedBySecret: string,
    at: string,
  ): Promise<boolean>;
  /** Puts a new recovery key in place. False for an account without keys. */
  setRecovery(
    userId: string,
    wrappedByRecovery: string,
    recoveryVerifierHash: string,
    at: string,
  ): Promise<boolean>;
  /**
   * Uses a recovery key. It puts a new secret key and a new recovery key in
   * place of the keys of the account, in one write, and only while the recovery
   * key is still `expectedVerifierHash`. False when it is not. Thus, a key used
   * two times at the same time is used one time.
   */
  replaceUserKeys(
    userId: string,
    expectedVerifierHash: string,
    next: ReplacementUserKeys,
    at: string,
  ): Promise<boolean>;
  /** Removes the keys of the account, for an account that starts again. */
  delete(userId: string): Promise<boolean>;
}

/** A passkey as stored: the public half of the credential, and its owner. */
export interface StoredPasskey extends Passkey {
  userId: string;
  /** base64url, as the browser names it. */
  credentialId: string;
  /** The COSE public key, base64url. */
  publicKey: string;
  counter: number;
  transports: string[];
  /** The host for which it was made. */
  rpId: string;
}

export interface PasskeysRepo {
  create(passkey: StoredPasskey): Promise<void>;
  /** Oldest first. */
  listByUser(userId: string): Promise<StoredPasskey[]>;
  findByCredentialId(credentialId: string): Promise<StoredPasskey | null>;
  /**
   * Records a sign-in with it: the new counter of the authenticator, and when.
   */
  recordUse(id: string, counter: number, at: string): Promise<void>;
  /**
   * The passkey of the user. Thus, one user cannot remove the passkey of a
   * different user.
   */
  delete(id: string, userId: string): Promise<boolean>;
  deleteByUser(userId: string): Promise<number>;
}

/**
 * The tables of one-time links, the same in all but the name: the two that are
 * sent by mail, and the device links that a QR code carries.
 */
export type MailedLinksTable =
  | "password_resets"
  | "sign_in_links"
  | "device_links";

/**
 * Links sent by mail, with the SHA-256 of the token as the key. One shape for
 * both types, each in its own table (`passwordResets`, `signInLinks`). Thus, a
 * link of one type cannot be used as the other.
 */
export interface MailedLinksRepo {
  create(input: {
    tokenHash: string;
    userId: string;
    createdAt: string;
    expiresAt: string;
  }): Promise<void>;
  /**
   * The owner of this link, while it is unused and not expired at `now`,
   * without its use. The second factor is asked for while the link is still
   * good.
   */
  find(tokenHash: string, now: string): Promise<string | null>;
  /**
   * Uses a link that is unused and not expired at `now`, atomically, and tells
   * for which account it is. Null for all other links.
   */
  consume(tokenHash: string, now: string): Promise<string | null>;
  /**
   * Gives back a link that `consume` used, for a sign-in that then failed at
   * the second factor. It still expires at its original time.
   */
  release(tokenHash: string): Promise<void>;
  /** Removes one link, for a mail that never went out. */
  delete(tokenHash: string): Promise<void>;
  /** When the latest link of the user was made, to keep links apart in time. */
  latestFor(userId: string): Promise<string | null>;
  /**
   * Cancels all links made for the user. Thus, no link sent before still works.
   */
  deleteByUser(userId: string): Promise<number>;
  deleteExpired(now: string): Promise<number>;
}
