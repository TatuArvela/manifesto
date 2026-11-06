import { signal } from "@preact/signals";

/** The key of the unlocked account, as the device has it. */
export interface StorageKeys {
  userId: string;
  /** The version of the account key. */
  version: number;
  /** It derives, and cannot be read out. */
  accountKey: CryptoKey;
}

/**
 * Set by `state/account/accountKeys.ts` while the account is unlocked, and null
 * otherwise. Pushed in for the same reason as `storageConnection`: storage
 * never imports the state that knows about the unlock.
 */
export const storageKeys = signal<StorageKeys | null>(null);

/** A write that could not be sealed because the account is locked. */
export class LockedError extends Error {
  constructor() {
    super("The account is locked");
    this.name = "LockedError";
  }
}
