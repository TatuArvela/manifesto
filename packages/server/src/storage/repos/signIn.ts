import type { Passkey } from "@manifesto/shared";

// What secures a sign-in beyond the password: two-factor, passkeys, reset links.

export interface TotpState {
  secret: string;
  /** Null while set up but not yet confirmed with a code. */
  enabledAt: string | null;
  lastStep: number;
}

/** Two-factor sign-in (TOTP) for local accounts. */
export interface TwoFactorRepo {
  get(userId: string): Promise<TotpState | null>;
  /** Starts (or restarts) a setup with a new secret, unconfirmed. Refused
   * (false) while two-factor is on: that has to be turned off first. */
  begin(userId: string, secret: string, at: string): Promise<boolean>;
  /** Confirms a setup, recording the step of the code that confirmed it. */
  enable(userId: string, at: string, step: number): Promise<void>;
  /** Removes the authenticator and the recovery codes. */
  disable(userId: string): Promise<void>;
  /** Removes the authenticator and keeps the recovery codes, which passkeys
   * share. */
  removeAuthenticator(userId: string): Promise<void>;
  /**
   * Records `step` as used if it is later than the last one, atomically, and
   * says whether it was. False is a code used before: refuse it.
   */
  advanceStep(userId: string, step: number): Promise<boolean>;
  replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void>;
  /** Spends one unused recovery code; false if there is no such code. */
  useRecoveryCode(userId: string, hash: string, at: string): Promise<boolean>;
  remainingRecoveryCodes(userId: string): Promise<number>;
}

/** A passkey as stored: the public half of the credential and whose it is. */
export interface StoredPasskey extends Passkey {
  userId: string;
  /** base64url, as the browser names it. */
  credentialId: string;
  /** The COSE public key, base64url. */
  publicKey: string;
  counter: number;
  transports: string[];
  /** The host it was made for. */
  rpId: string;
}

export interface PasskeysRepo {
  create(passkey: StoredPasskey): Promise<void>;
  /** Oldest first. */
  listByUser(userId: string): Promise<StoredPasskey[]>;
  findByCredentialId(credentialId: string): Promise<StoredPasskey | null>;
  /** Records a sign-in with it: the authenticator's new counter, and when. */
  recordUse(id: string, counter: number, at: string): Promise<void>;
  /** The user's passkey, so one user cannot remove another's. */
  delete(id: string, userId: string): Promise<boolean>;
  deleteByUser(userId: string): Promise<number>;
}

/** The two tables of links sent by mail, alike in everything but the name. */
export type MailedLinksTable = "password_resets" | "sign_in_links";

/**
 * Links sent by mail, keyed by the token's SHA-256. One shape for both kinds,
 * each in a table of its own (`passwordResets`, `signInLinks`), so a link of
 * one kind cannot be spent as the other.
 */
export interface MailedLinksRepo {
  create(input: {
    tokenHash: string;
    userId: string;
    createdAt: string;
    expiresAt: string;
  }): Promise<void>;
  /**
   * Whose link this is, while it is unused and unexpired at `now`, without
   * spending it: the second factor is asked for with the link still good.
   */
  find(tokenHash: string, now: string): Promise<string | null>;
  /**
   * Spends a link that is unused and unexpired at `now`, atomically, and
   * says whose account it is for; null for any other link.
   */
  consume(tokenHash: string, now: string): Promise<string | null>;
  /**
   * Hands back a link `consume` spent, for a sign-in that then failed at the
   * second factor. It still expires when it would have.
   */
  release(tokenHash: string): Promise<void>;
  /** Removes one link, for a mail that never went. */
  delete(tokenHash: string): Promise<void>;
  /** When the user's latest link was made, for spacing them out. */
  latestFor(userId: string): Promise<string | null>;
  /** Voids every link made for the user, so none sent before still works. */
  deleteByUser(userId: string): Promise<number>;
  deleteExpired(now: string): Promise<number>;
}
