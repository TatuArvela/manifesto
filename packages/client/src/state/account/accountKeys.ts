import { cryptoAvailable } from "@manifesto/shared";
import { computed, effect, untracked } from "@preact/signals";
import { apiFetch } from "#/storage/apiRequest.ts";
import { clearDeviceKeys, loadDeviceKeys } from "#/storage/deviceKeys.ts";
import { createAccountKeys, unlockAccountKey } from "#/utils/keyMaterial.ts";
import { parseUserKey } from "#/utils/userKey.ts";
import { authToken, currentUser, isServerMode } from "./auth.ts";
import {
  announce,
  channel,
  device,
  fetchKeys,
  forget,
  hold,
  type KeySheet,
  keyState,
  setHeld,
  sheet,
} from "./keyHold.ts";
import { type Confirmed, refusalOf, withPassword } from "./keyRenewal.ts";

export { type KeySheet, type KeyState, keyState } from "./keyHold.ts";
export {
  abandonRecovery,
  beginRecovery,
  beginRecoverySignIn,
  completeRecovery,
  type RecoveryResult,
} from "./keyRecovery.ts";
export {
  abandonRenewal,
  completeRenewal,
  prepareRecoveryKey,
  prepareSecretKey,
  revealSecretKey,
  sheetFor,
} from "./keyRenewal.ts";

/**
 * The keys of the account on this device
 * (`docs/specification/features/encryption.md`, "Unlocking").
 *
 * A sign-in proves who a person is, and opens nothing. A signed-in device is
 * `locked` until the person enters the secret key. An account that never had
 * keys is at `setup`, where the browser makes them. The app shows only in the
 * `unlocked` state.
 *
 * What the device holds is in `keyHold.ts`. The recovery (`keyRecovery.ts`)
 * and the new keys from Settings (`keyRenewal.ts`) are exported from here.
 *
 * Each action here resolves with what occurred, and never rejects.
 */

/**
 * The account key, for the code that encrypts and decrypts. Null while locked.
 */
export function accountKey(): CryptoKey | null {
  return keyState.value === "unlocked"
    ? (device.held?.accountKey ?? null)
    : null;
}

/**
 * Decides the state for the person who is signed in now: unlocked from what the
 * device has, or else what the server says that the account has. Runs when the
 * session changes, and again from the screens that offer a retry.
 */
export async function checkAccountKeys(): Promise<void> {
  const run = ++device.generation;
  const user = currentUser.value;
  if (!isServerMode || authToken.value === null || user === null) {
    forget();
    keyState.value = "none";
    // A sign-out removes the keys. A session that the server ended also does.
    if (isServerMode) await clearDeviceKeys();
    return;
  }
  if (!cryptoAvailable()) {
    keyState.value = "unsupported";
    return;
  }
  if (device.held?.userId === user.id) {
    keyState.value = "unlocked";
    return;
  }
  forget();
  keyState.value = "checking";
  const stored = await loadDeviceKeys();
  if (run !== device.generation) return;
  if (stored) {
    // Kept only for their account, and only until the day when its session
    // would have ended. A device that was off never heard it end.
    if (stored.userId === user.id && Date.parse(stored.endsAt) > Date.now()) {
      setHeld(stored);
      keyState.value = "unlocked";
      return;
    }
    await clearDeviceKeys();
    if (run !== device.generation) return;
  }
  const answer = await fetchKeys();
  if (run !== device.generation) return;
  if (!answer) {
    keyState.value = "unavailable";
    return;
  }
  device.served = answer;
  if (!answer.keys) {
    keyState.value = "setup";
    return;
  }
  keyState.value = "locked";
  if (device.scannedSecretKey !== null) await unlock(device.scannedSecretKey);
}

/** Who is signed in, and nothing else about them. */
const signedInAs = computed(() => currentUser.value?.id ?? null);

// The state follows the session. A sign-in asks for the key. A sign-out, or a
// session that the server ended (`clearAuthLocal`), removes it.
effect(() => {
  // Read, so that the effect runs again when either changes.
  void authToken.value;
  void signedInAs.value;
  // Untracked, because the check reads all of `currentUser`. The same account
  // under a new name or language is not a new session. A new decision would
  // discard the keys of a set-up or a recovery whose sheet is already on the
  // screen.
  untracked(() => void checkAccountKeys());
});

/**
 * A different tab wrote the copy of the keys of the device. A tab that has
 * nothing reads it, and does not ask for the key two times. A tab that is
 * unlocked keeps what it has while the copy is of the same account key. If it
 * released it, each save in progress would fail, the app would close for the
 * person who types, and it would come back with a `Sealer` that forgot each
 * note and image key that it had opened. The tab takes a new secret key for the
 * same account key as it is. A copy that it cannot read changes nothing.
 */
async function heardFromAnotherTab(said: unknown): Promise<void> {
  const mine = device.held;
  if (mine !== null && said !== "gone") {
    const stored = await loadDeviceKeys();
    if (device.held !== mine) {
      // This tab changed what it has in the meantime, and decides for itself.
      await checkAccountKeys();
      return;
    }
    // No copy to read. This browser keeps none (the keys are only in memory),
    // or the copy of the other tab was not written. Nothing says that the keys
    // here are not the keys of the account now. `gone` is for that.
    if (stored === null) return;
    if (stored.userId === mine.userId && stored.version === mine.version) {
      setHeld({ ...mine, secretKey: stored.secretKey });
      return;
    }
  }
  setHeld(null);
  await checkAccountKeys();
}

if (channel) {
  channel.onmessage = (event) => {
    void heardFromAnotherTab(event.data);
  };
}

/**
 * Takes a secret key out of the address (`#key=SK-...`), where the QR code that
 * Settings shows on a signed-in device puts it, and removes it from the address
 * bar and the history. It unlocks immediately when the account waits for it.
 * Until then, it is kept in memory, and never stored.
 */
export function takeSecretKeyFromAddress(): void {
  if (typeof window === "undefined") return;
  const match = /^#key=([-0-9A-Za-z]{28,40})$/.exec(window.location.hash);
  if (!match) return;
  history.replaceState(
    history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  holdScannedSecretKey(match[1] ?? "");
}

/**
 * Keeps a secret key that a QR code brought (the key code, or the code that
 * signs in a device), in memory only. It unlocks when the account waits for it.
 */
export function holdScannedSecretKey(raw: string): void {
  const key = parseUserKey(raw, "secret");
  if (key === null) return;
  device.scannedSecretKey = key;
  if (keyState.value === "locked") void unlock(key);
}

/** The address that carries `secretKey` to a different device, as a QR code. */
export function secretKeyAddress(secretKey: string): string {
  if (typeof window === "undefined") return "";
  const app = new URL(import.meta.env.BASE_URL, window.location.origin);
  return `${app.href}#key=${secretKey}`;
}

/**
 * Makes the first keys of an account, and answers the sheet to show. Nothing
 * reached the server yet. That is `completeSetup`, after the user says that
 * they kept the sheet. Null when the browser could not make them.
 */
export async function prepareSetup(): Promise<KeySheet | null> {
  const user = currentUser.value;
  if (!user) return null;
  try {
    device.pendingSetup ??= await createAccountKeys(user.id);
  } catch {
    return null;
  }
  return sheet(device.pendingSetup.secretKey, device.pendingSetup.recoveryKey);
}

/**
 * Stores the keys that `prepareSetup` made. `exists` means that a different
 * device set up the account in the meantime, and this device now asks for the
 * key of that device.
 */
export async function completeSetup(): Promise<"ok" | "exists" | "failed"> {
  const user = currentUser.value;
  const made = device.pendingSetup;
  if (!user || !made) return "failed";
  const res = await apiFetch("PUT", "/auth/keys", made.request);
  if (res?.status === 409) {
    device.pendingSetup = null;
    await checkAccountKeys();
    return "exists";
  }
  if (!res?.ok) return "failed";
  const kept = await hold(
    {
      userId: user.id,
      version: made.version,
      secretKey: made.secretKey,
      accountKey: made.accountKey,
    },
    device.served?.sessionEndsAt ?? null,
  );
  return kept ? "ok" : "failed";
}

export type UnlockResult =
  | "ok"
  /** Not in the shape of a secret key. */
  | "invalid"
  /** A secret key, but not of this account. */
  | "wrong"
  | "failed";

/** Unlocks with the secret key as typed, pasted or scanned. */
export async function unlock(input: string): Promise<UnlockResult> {
  const user = currentUser.value;
  const keys = device.served?.keys;
  if (!user || !keys) return "failed";
  const secretKey = parseUserKey(input, "secret");
  if (secretKey === null) return "invalid";
  let key: CryptoKey | null;
  try {
    key = await unlockAccountKey(user.id, keys, secretKey);
  } catch {
    return "failed";
  }
  if (key === null) {
    // A scanned key that does not open is not tried again automatically.
    device.scannedSecretKey = null;
    return "wrong";
  }
  const kept = await hold(
    { userId: user.id, version: keys.version, secretKey, accountKey: key },
    device.served?.sessionEndsAt ?? null,
  );
  return kept ? "ok" : "failed";
}

/**
 * Starts the account again, for a person who lost the secret key on each device
 * and also the recovery key. Its keys are removed, and the next screen is the
 * set-up of new keys.
 */
export async function startAgain(password: string): Promise<Confirmed<object>> {
  const res = await apiFetch("DELETE", "/auth/keys", withPassword(password));
  if (!res?.ok) return refusalOf(res);
  setHeld(null);
  await clearDeviceKeys();
  await checkAccountKeys();
  announce("gone");
  return { kind: "ok" };
}
