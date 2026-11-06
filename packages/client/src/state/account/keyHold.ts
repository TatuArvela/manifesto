import type {
  AccountKeysResponse,
  RecoveryOpenResponse,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { apiFetch } from "#/storage/apiRequest.ts";
import { type DeviceKeys, saveDeviceKeys } from "#/storage/deviceKeys.ts";
import { storageKeys } from "#/storage/storageKeys.ts";
import type {
  NewAccountKeys,
  NewRecoveryKey,
  NewSecretKey,
  RecoveredKeys,
} from "#/utils/keyMaterial.ts";
import { authToken, currentUser, SERVER_ORIGIN } from "./auth.ts";

/**
 * What the device holds of the keys of the account, and the few functions that
 * change it. `accountKeys.ts` decides the state, and `keyRecovery.ts` and
 * `keyRenewal.ts` contain the flows that make new keys. All three change what
 * is held only through this module.
 */

export type KeyState =
  /** Open mode, or nobody signed in: there is nothing to unlock. */
  | "none"
  | "checking"
  /** No WebCrypto: the page loaded over plain `http`. */
  | "unsupported"
  /** The client could not ask the server if the account has keys. */
  | "unavailable"
  | "setup"
  | "locked"
  | "unlocked";

export const keyState = signal<KeyState>("none");

/**
 * The two keys and where they belong, as the sheet to save or print shows them.
 * `secretKey` and `recoveryKey` are null on a sheet that shows only one.
 */
export interface KeySheet {
  server: string;
  username: string;
  secretKey: string | null;
  recoveryKey: string | null;
}

export type HeldKeys = Omit<DeviceKeys, "endsAt">;

/** The state of the keys on this device, which the flows share. */
export const device: {
  /** What this device has in memory while unlocked. IndexedDB has a copy. */
  held: HeldKeys | null;
  /** What the server said the last time that the client asked. */
  served: AccountKeysResponse | null;
  /** Keys made for a set-up that the user did not yet confirm that they keep. */
  pendingSetup: NewAccountKeys | null;
  /** A recovery in progress: what was opened, until the new sheet is kept. */
  pendingRecovery: {
    recovered: RecoveredKeys;
    verifier: string;
    opened: RecoveryOpenResponse;
    /** Set when nobody is signed in and the recovery signs in. */
    username: string | null;
  } | null;
  /** A new secret or recovery key made in Settings, until its sheet is kept. */
  pendingRenewal:
    | ({ kind: "secret" } & NewSecretKey)
    | ({ kind: "recovery" } & NewRecoveryKey)
    | null;
  /** A secret key scanned into the address before the account was unlocked. */
  scannedSecretKey: string | null;
  /**
   * Increased each time the state is decided. Thus, an older check does not
   * answer over a newer check.
   */
  generation: number;
} = {
  held: null,
  served: null,
  pendingSetup: null,
  pendingRecovery: null,
  pendingRenewal: null,
  scannedSecretKey: null,
  generation: 0,
};

/**
 * Changes what this device has, and tells the storage layer, which seals and
 * opens with it. The same account key goes across one time. A new secret key
 * for it changes nothing that storage must know.
 */
export function setHeld(keys: HeldKeys | null): void {
  device.held = keys;
  const told = storageKeys.peek();
  if (keys === null) {
    if (told !== null) storageKeys.value = null;
    return;
  }
  if (
    told?.userId === keys.userId &&
    told.version === keys.version &&
    told.accountKey === keys.accountKey
  ) {
    return;
  }
  storageKeys.value = {
    userId: keys.userId,
    version: keys.version,
    accountKey: keys.accountKey,
  };
}

export function sheet(
  secretKey: string | null,
  recoveryKey: string | null,
): KeySheet {
  return {
    server: SERVER_ORIGIN ?? "",
    username: currentUser.value?.username ?? "",
    secretKey,
    recoveryKey,
  };
}

export async function fetchKeys(): Promise<AccountKeysResponse | null> {
  const res = await apiFetch("GET", "/auth/keys");
  if (!res?.ok) return null;
  try {
    return (await res.json()) as AccountKeysResponse;
  } catch {
    return null;
  }
}

/**
 * What a tab tells the others: the copy of the device was written (`held`), or
 * the keys of the account were removed and it starts again (`gone`).
 */
type Announcement = "held" | "gone";

/** The channel to the other tabs. `accountKeys.ts` listens on it. */
export const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("manifesto:keys");

export function announce(said: Announcement = "held"): void {
  channel?.postMessage(said);
}

/**
 * Keeps the keys in memory and on the device, shows the app, and tells the
 * other tabs when the copy of the device was written. A copy that the browser
 * would not keep is nothing for them to read. Returns false, with nothing held,
 * when the account of the keys is not signed in now. Each caller awaited a
 * request first, and a device has keys only while signed in.
 */
export async function hold(
  keys: HeldKeys,
  endsAt: string | null,
): Promise<boolean> {
  if (authToken.peek() === null || currentUser.peek()?.id !== keys.userId) {
    return false;
  }
  device.generation++;
  setHeld(keys);
  device.pendingSetup = null;
  device.pendingRecovery = null;
  device.pendingRenewal = null;
  device.scannedSecretKey = null;
  keyState.value = "unlocked";
  // Without the day on which the session ends, the device could not tell when
  // to remove them by itself. Thus, it keeps them only in memory.
  if (endsAt !== null && (await saveDeviceKeys({ ...keys, endsAt }))) {
    announce();
  }
  return true;
}

export function forget(): void {
  setHeld(null);
  device.served = null;
  device.pendingSetup = null;
  device.pendingRecovery = null;
  device.pendingRenewal = null;
}
