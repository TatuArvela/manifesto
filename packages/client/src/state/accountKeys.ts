import type {
  AccountKeys,
  AccountKeysResponse,
  AuthSuccessResponse,
  RecoveryCompleteRequest,
  RecoveryOpenResponse,
} from "@manifesto/shared";
import { effect, signal } from "@preact/signals";
import { apiFetch } from "../storage/apiRequest.js";
import {
  clearDeviceKeys,
  type DeviceKeys,
  loadDeviceKeys,
  saveDeviceKeys,
} from "../storage/deviceKeys.js";
import { storageKeys } from "../storage/sealing.js";
import {
  createAccountKeys,
  type NewAccountKeys,
  type RecoveredKeys,
  recoverAccountKey,
  recoveryVerifierOf,
  replaceRecoveryKey,
  replaceSecretKey,
  unlockAccountKey,
} from "../utils/keyMaterial.js";
import { cryptoAvailable } from "../utils/seal.js";
import { parseUserKey } from "../utils/userKey.js";
import {
  adoptSession,
  authToken,
  currentUser,
  isServerMode,
  recoveryRequest,
  SERVER_ORIGIN,
} from "./auth.js";
import {
  type ConfirmationRefusal,
  confirmationRefusal,
} from "./passwordConfirmation.js";

/**
 * The account's keys on this device
 * (`docs/specification/features/encryption.md`, "Unlocking").
 *
 * Signing in proves who someone is and opens nothing. A signed-in device is
 * `locked` until the secret key is entered, and an account that has never had
 * keys is at `setup`, where the browser makes them. `unlocked` is the only
 * state in which the app is shown.
 *
 * Every action here resolves with what happened and never rejects.
 */
export type KeyState =
  /** Open mode, or nobody signed in: there is nothing to unlock. */
  | "none"
  | "checking"
  /** No WebCrypto: the page was loaded over plain `http`. */
  | "unsupported"
  /** The server could not be asked whether the account has keys. */
  | "unavailable"
  | "setup"
  | "locked"
  | "unlocked";

export const keyState = signal<KeyState>("none");

/** The two keys and where they belong, as the sheet to save or print shows
 * them. `secretKey` and `recoveryKey` are null on a sheet that shows one. */
export interface KeySheet {
  server: string;
  username: string;
  secretKey: string | null;
  recoveryKey: string | null;
}

/** What this device holds while unlocked, in memory; IndexedDB has a copy. */
let held: Omit<DeviceKeys, "endsAt"> | null = null;
/** What the server said the last time it was asked. */
let served: AccountKeysResponse | null = null;
/** Keys made for a set-up the user has not confirmed keeping yet. */
let pendingSetup: NewAccountKeys | null = null;
/** A recovery under way: what was opened, until the new sheet is kept. */
let pendingRecovery: {
  recovered: RecoveredKeys;
  verifier: string;
  opened: RecoveryOpenResponse;
  /** Set when nobody is signed in and the recovery signs in. */
  username: string | null;
} | null = null;
/** A secret key scanned into the address before the account was unlocked. */
let scannedSecretKey: string | null = null;
/** Raised whenever the state is decided, so an older check does not answer
 * over a newer one. */
let generation = 0;

/**
 * Changes what this device holds, and tells the storage layer, which seals
 * and opens with it. The same account key is handed over once: a new secret
 * key for it changes nothing storage has to know.
 */
function setHeld(keys: Omit<DeviceKeys, "endsAt"> | null): void {
  held = keys;
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

/** The account key, for whatever encrypts and decrypts; null while locked. */
export function accountKey(): CryptoKey | null {
  return keyState.value === "unlocked" ? (held?.accountKey ?? null) : null;
}

function sheet(secretKey: string | null, recoveryKey: string | null): KeySheet {
  return {
    server: SERVER_ORIGIN ?? "",
    username: currentUser.value?.username ?? "",
    secretKey,
    recoveryKey,
  };
}

async function fetchKeys(): Promise<AccountKeysResponse | null> {
  const res = await apiFetch("GET", "/auth/keys");
  if (!res?.ok) return null;
  try {
    return (await res.json()) as AccountKeysResponse;
  } catch {
    return null;
  }
}

/** Holds the keys in memory and on the device, and shows the app. */
async function hold(
  keys: Omit<DeviceKeys, "endsAt">,
  endsAt: string | null,
): Promise<void> {
  generation++;
  setHeld(keys);
  pendingSetup = null;
  pendingRecovery = null;
  scannedSecretKey = null;
  keyState.value = "unlocked";
  // Without the day the session ends, the device could not tell when to
  // remove them by itself, so it keeps them in memory alone.
  if (endsAt !== null) await saveDeviceKeys({ ...keys, endsAt });
}

function forget(): void {
  setHeld(null);
  served = null;
  pendingSetup = null;
  pendingRecovery = null;
}

/**
 * Decides the state for whoever is signed in now: unlocked from what the
 * device holds, or else whatever the server says the account has. Runs when
 * the session changes, and again from the screens that offer a retry.
 */
export async function checkAccountKeys(): Promise<void> {
  const run = ++generation;
  const user = currentUser.value;
  if (!isServerMode || authToken.value === null || user === null) {
    forget();
    keyState.value = "none";
    // Signing out removes the keys, and so does a session the server ended.
    if (isServerMode) await clearDeviceKeys();
    return;
  }
  if (!cryptoAvailable()) {
    keyState.value = "unsupported";
    return;
  }
  if (held?.userId === user.id) {
    keyState.value = "unlocked";
    return;
  }
  forget();
  keyState.value = "checking";
  const stored = await loadDeviceKeys();
  if (run !== generation) return;
  if (stored) {
    // Kept only for the account they are, and only until the day its session
    // would have run out: a device that was off never heard it end.
    if (stored.userId === user.id && Date.parse(stored.endsAt) > Date.now()) {
      setHeld(stored);
      keyState.value = "unlocked";
      return;
    }
    await clearDeviceKeys();
    if (run !== generation) return;
  }
  const answer = await fetchKeys();
  if (run !== generation) return;
  if (!answer) {
    keyState.value = "unavailable";
    return;
  }
  served = answer;
  if (!answer.keys) {
    keyState.value = "setup";
    return;
  }
  keyState.value = "locked";
  if (scannedSecretKey !== null) await unlock(scannedSecretKey);
}

// The state follows the session: a sign-in asks for the key, and a sign-out
// or a session the server ended (`clearAuthLocal`) removes it.
effect(() => {
  // Read so the effect runs again when either changes.
  void authToken.value;
  void currentUser.value?.id;
  void checkAccountKeys();
});

// Another tab that unlocks, signs out or is given new keys writes the device's
// copy; this one reads it again rather than asking for the key twice.
const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("manifesto:keys");
if (channel) {
  channel.onmessage = () => {
    setHeld(null);
    void checkAccountKeys();
  };
}

function announce(): void {
  channel?.postMessage("changed");
}

/**
 * Takes a secret key out of the address (`#key=SK-...`), where the QR code
 * Settings shows on a signed-in device puts it, and removes it from the
 * address bar and the history. It unlocks at once when the account is
 * waiting for it, and is kept in memory, never stored, until then.
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
  const key = parseUserKey(match[1] ?? "", "secret");
  if (key === null) return;
  scannedSecretKey = key;
  if (keyState.value === "locked") void unlock(key);
}

/** The address that carries `secretKey` to another device, as a QR code. */
export function secretKeyAddress(secretKey: string): string {
  if (typeof window === "undefined") return "";
  const app = new URL(import.meta.env.BASE_URL, window.location.origin);
  return `${app.href}#key=${secretKey}`;
}

/**
 * Makes an account's first keys and answers the sheet to show. Nothing has
 * reached the server yet: that is `completeSetup`, once the user says they
 * kept the sheet. Null when the browser could not make them.
 */
export async function prepareSetup(): Promise<KeySheet | null> {
  const user = currentUser.value;
  if (!user) return null;
  try {
    pendingSetup ??= await createAccountKeys(user.id);
  } catch {
    return null;
  }
  return sheet(pendingSetup.secretKey, pendingSetup.recoveryKey);
}

/** Stores the keys `prepareSetup` made. `exists` means another device set
 * the account up meanwhile, and this one now asks for that device's key. */
export async function completeSetup(): Promise<"ok" | "exists" | "failed"> {
  const user = currentUser.value;
  const made = pendingSetup;
  if (!user || !made) return "failed";
  const res = await apiFetch("PUT", "/auth/keys", made.request);
  if (res?.status === 409) {
    pendingSetup = null;
    await checkAccountKeys();
    return "exists";
  }
  if (!res?.ok) return "failed";
  await hold(
    {
      userId: user.id,
      version: made.version,
      secretKey: made.secretKey,
      accountKey: made.accountKey,
    },
    served?.sessionEndsAt ?? null,
  );
  announce();
  return "ok";
}

export type UnlockResult =
  | "ok"
  /** Not shaped as a secret key at all. */
  | "invalid"
  /** A secret key, and not this account's. */
  | "wrong"
  | "failed";

/** Unlocks with the secret key as typed, pasted or scanned. */
export async function unlock(input: string): Promise<UnlockResult> {
  const user = currentUser.value;
  const keys = served?.keys;
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
    // A scanned key that does not open is not tried again by itself.
    scannedSecretKey = null;
    return "wrong";
  }
  await hold(
    { userId: user.id, version: keys.version, secretKey, accountKey: key },
    served?.sessionEndsAt ?? null,
  );
  announce();
  return "ok";
}

export type RecoveryResult =
  | { kind: "ok"; sheet: KeySheet }
  | {
      kind:
        | "invalid"
        /** Not this account's recovery key. */
        | "wrong"
        /** Too many wrong ones; try again later. */
        | "throttled"
        | "failed";
    };

/** Opens what the server handed over and makes the new keys; shared by both
 * ways of using the recovery key. */
async function openRecovery(
  recoveryKey: string,
  verifier: string,
  opened: RecoveryOpenResponse,
  username: string | null,
): Promise<RecoveryResult> {
  let recovered: RecoveredKeys | null;
  try {
    recovered = await recoverAccountKey(opened, recoveryKey);
  } catch {
    return { kind: "failed" };
  }
  // The server took the key and its wrap does not open: not a key to trust.
  if (recovered === null) return { kind: "failed" };
  pendingRecovery = { recovered, verifier, opened, username };
  return {
    kind: "ok",
    sheet: {
      server: SERVER_ORIGIN ?? "",
      username: username ?? currentUser.value?.username ?? "",
      secretKey: recovered.secretKey,
      recoveryKey: recovered.recoveryKey,
    },
  };
}

async function verifierFor(input: string): Promise<{
  recoveryKey: string;
  verifier: string;
} | null> {
  const recoveryKey = parseUserKey(input, "recovery");
  if (recoveryKey === null || !cryptoAvailable()) return null;
  try {
    return { recoveryKey, verifier: await recoveryVerifierOf(recoveryKey) };
  } catch {
    return null;
  }
}

/**
 * The first step of using the recovery key while signed in, for someone who
 * has lost the secret key: checks it with the server and answers a sheet with
 * a new secret key and a new recovery key. Nothing is replaced until
 * `completeRecovery`.
 */
export async function beginRecovery(input: string): Promise<RecoveryResult> {
  const parsed = await verifierFor(input);
  if (parsed === null) return { kind: "invalid" };
  const res = await apiFetch("POST", "/auth/keys/recover", {
    verifier: parsed.verifier,
  });
  if (res?.status === 403) return { kind: "wrong" };
  if (res?.status === 429) return { kind: "throttled" };
  if (!res?.ok) return { kind: "failed" };
  let opened: RecoveryOpenResponse;
  try {
    opened = (await res.json()) as RecoveryOpenResponse;
  } catch {
    return { kind: "failed" };
  }
  return openRecovery(parsed.recoveryKey, parsed.verifier, opened, null);
}

/** The same with nobody signed in, by username: the recovery then signs in. */
export async function beginRecoverySignIn(
  username: string,
  input: string,
): Promise<RecoveryResult> {
  const parsed = await verifierFor(input);
  if (parsed === null) return { kind: "invalid" };
  const answer = await recoveryRequest<RecoveryOpenResponse>("open", {
    username,
    verifier: parsed.verifier,
  });
  if (answer.kind === "wrong" || answer.kind === "throttled") {
    return { kind: answer.kind };
  }
  if (answer.kind !== "ok") return { kind: "failed" };
  return openRecovery(
    parsed.recoveryKey,
    parsed.verifier,
    answer.body,
    username,
  );
}

/**
 * The second step: puts the new keys in place of the ones the recovery used,
 * and unlocks this device with them. With nobody signed in it takes the new
 * password and signs in. `used` means the recovery key was spent meanwhile.
 */
export async function completeRecovery(
  newPassword?: string,
): Promise<"ok" | "used" | "failed"> {
  const pending = pendingRecovery;
  if (!pending) return "failed";
  const { recovered, opened } = pending;
  const body: RecoveryCompleteRequest = {
    verifier: pending.verifier,
    wrappedBySecret: recovered.wrappedBySecret,
    wrappedByRecovery: recovered.wrappedByRecovery,
    recoveryVerifier: recovered.recoveryVerifier,
  };
  const keys = {
    userId: opened.userId,
    version: recovered.version,
    secretKey: recovered.secretKey,
    accountKey: recovered.accountKey,
  };
  if (pending.username === null) {
    const res = await apiFetch("POST", "/auth/keys/recover/complete", body);
    if (res?.status === 409 || res?.status === 403) return "used";
    if (!res?.ok) return "failed";
    await hold(keys, served?.sessionEndsAt ?? null);
    announce();
    return "ok";
  }
  const answer = await recoveryRequest<AuthSuccessResponse>("complete", {
    ...body,
    username: pending.username,
    newPassword,
  });
  if (answer.kind === "used" || answer.kind === "wrong") return "used";
  if (answer.kind !== "ok") return "failed";
  // Held before the session is taken up, so the check that follows the
  // sign-in finds the account unlocked and asks for nothing.
  generation++;
  setHeld(keys);
  pendingRecovery = null;
  adoptSession(answer.body);
  const now = await fetchKeys();
  if (now) served = now;
  await hold(keys, now?.sessionEndsAt ?? null);
  announce();
  return "ok";
}

/** Drops a set-up or a recovery that was not finished. */
export function abandonRecovery(): void {
  pendingRecovery = null;
}

type Confirmed<T> =
  | ({ kind: "ok" } & T)
  | { kind: ConfirmationRefusal | "failed" };

/** What a refused or failed request says, for the forms that confirm. */
async function refusalOf(
  res: Response | null,
): Promise<{ kind: ConfirmationRefusal | "failed" }> {
  const refusal = res ? await confirmationRefusal(res) : null;
  return { kind: refusal ?? "failed" };
}

const withPassword = (password: string) => (password ? { password } : {});

/**
 * The secret key this device holds, after the server has checked the
 * password (or, for an account without one, a recent sign-in): what Settings
 * shows to bring another device in.
 */
export async function revealSecretKey(
  password: string,
): Promise<Confirmed<{ secretKey: string }>> {
  const secretKey = held?.secretKey;
  if (!secretKey) return { kind: "failed" };
  const res = await apiFetch(
    "POST",
    "/auth/keys/confirm",
    withPassword(password),
  );
  if (!res?.ok) return refusalOf(res);
  return { kind: "ok", secretKey };
}

/** The wrap the server holds now, which the secret key here has to open
 * before anything can be wrapped anew. */
async function currentKeys(): Promise<AccountKeys | null> {
  const answer = await fetchKeys();
  if (answer) served = answer;
  return answer?.keys ?? null;
}

/**
 * A new secret key in place of the one this device holds. Every other device
 * is signed out and asks for the new one.
 */
export async function renewSecretKey(
  password: string,
): Promise<Confirmed<{ secretKey: string }>> {
  const mine = held;
  const keys = await currentKeys();
  if (!mine || !keys) return { kind: "failed" };
  let next: Awaited<ReturnType<typeof replaceSecretKey>>;
  try {
    next = await replaceSecretKey(mine.userId, keys, mine.secretKey);
  } catch {
    return { kind: "failed" };
  }
  if (next === null) return { kind: "failed" };
  const res = await apiFetch("POST", "/auth/keys/secret", {
    ...withPassword(password),
    wrappedBySecret: next.wrappedBySecret,
  });
  if (!res?.ok) return refusalOf(res);
  await hold(
    { ...mine, secretKey: next.secretKey },
    served?.sessionEndsAt ?? null,
  );
  announce();
  return { kind: "ok", secretKey: next.secretKey };
}

/** A new recovery key; the one on the old sheet stops working. */
export async function renewRecoveryKey(
  password: string,
): Promise<Confirmed<{ recoveryKey: string }>> {
  const mine = held;
  const keys = await currentKeys();
  if (!mine || !keys) return { kind: "failed" };
  let next: Awaited<ReturnType<typeof replaceRecoveryKey>>;
  try {
    next = await replaceRecoveryKey(mine.userId, keys, mine.secretKey);
  } catch {
    return { kind: "failed" };
  }
  if (next === null) return { kind: "failed" };
  const res = await apiFetch("POST", "/auth/keys/recovery", {
    ...withPassword(password),
    wrappedByRecovery: next.wrappedByRecovery,
    recoveryVerifier: next.recoveryVerifier,
  });
  if (!res?.ok) return refusalOf(res);
  return { kind: "ok", recoveryKey: next.recoveryKey };
}

/** A sheet for one new key, to save beside or in place of the old one. */
export function sheetFor(key: {
  secretKey?: string;
  recoveryKey?: string;
}): KeySheet {
  return sheet(key.secretKey ?? null, key.recoveryKey ?? null);
}

/**
 * Starts the account again, for someone who has lost the secret key on every
 * device and the recovery key too: its keys are removed, and the next thing
 * shown is the set-up of new ones.
 */
export async function startAgain(password: string): Promise<Confirmed<object>> {
  const res = await apiFetch("DELETE", "/auth/keys", withPassword(password));
  if (!res?.ok) return refusalOf(res);
  setHeld(null);
  await clearDeviceKeys();
  await checkAccountKeys();
  announce();
  return { kind: "ok" };
}
