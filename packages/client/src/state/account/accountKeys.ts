import type {
  AccountKeys,
  AccountKeysResponse,
  AuthSuccessResponse,
  RecoveryCompleteRequest,
  RecoveryOpenResponse,
} from "@manifesto/shared";
import { cryptoAvailable } from "@manifesto/shared";
import { computed, effect, signal, untracked } from "@preact/signals";
import { apiFetch } from "#/storage/apiRequest.ts";
import {
  clearDeviceKeys,
  type DeviceKeys,
  loadDeviceKeys,
  saveDeviceKeys,
} from "#/storage/deviceKeys.ts";
import { storageKeys } from "#/storage/sealing.ts";
import {
  createAccountKeys,
  type NewAccountKeys,
  type NewRecoveryKey,
  type NewSecretKey,
  type RecoveredKeys,
  recoverAccountKey,
  recoveryVerifierOf,
  replaceRecoveryKey,
  replaceSecretKey,
  unlockAccountKey,
} from "#/utils/keyMaterial.ts";
import { parseUserKey } from "#/utils/userKey.ts";
import {
  adoptSession,
  authToken,
  currentUser,
  isServerMode,
  recoveryRequest,
  SERVER_ORIGIN,
} from "./auth.ts";
import {
  type ConfirmationRefusal,
  confirmationRefusal,
} from "./passwordConfirmation.ts";

/**
 * The keys of the account on this device
 * (`docs/specification/features/encryption.md`, "Unlocking").
 *
 * A sign-in proves who a person is, and opens nothing. A signed-in device is
 * `locked` until the person enters the secret key. An account that never had
 * keys is at `setup`, where the browser makes them. The app shows only in the
 * `unlocked` state.
 *
 * Each action here resolves with what occurred, and never rejects.
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

/** What this device has in memory while unlocked. IndexedDB has a copy. */
let held: Omit<DeviceKeys, "endsAt"> | null = null;
/** What the server said the last time that the client asked. */
let served: AccountKeysResponse | null = null;
/** Keys made for a set-up that the user did not yet confirm that they keep. */
let pendingSetup: NewAccountKeys | null = null;
/** A recovery in progress: what was opened, until the new sheet is kept. */
let pendingRecovery: {
  recovered: RecoveredKeys;
  verifier: string;
  opened: RecoveryOpenResponse;
  /** Set when nobody is signed in and the recovery signs in. */
  username: string | null;
} | null = null;
/** A new secret or recovery key made in Settings, until its sheet is kept. */
let pendingRenewal:
  | ({ kind: "secret" } & NewSecretKey)
  | ({ kind: "recovery" } & NewRecoveryKey)
  | null = null;
/** A secret key scanned into the address before the account was unlocked. */
let scannedSecretKey: string | null = null;
/**
 * Increased each time the state is decided. Thus, an older check does not
 * answer over a newer check.
 */
let generation = 0;

/**
 * Changes what this device has, and tells the storage layer, which seals and
 * opens with it. The same account key goes across one time. A new secret key
 * for it changes nothing that storage must know.
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

/**
 * The account key, for the code that encrypts and decrypts. Null while locked.
 */
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

/**
 * Keeps the keys in memory and on the device, shows the app, and tells the
 * other tabs when the copy of the device was written. A copy that the browser
 * would not keep is nothing for them to read. Returns false, with nothing held,
 * when the account of the keys is not signed in now. Each caller awaited a
 * request first, and a device has keys only while signed in.
 */
async function hold(
  keys: Omit<DeviceKeys, "endsAt">,
  endsAt: string | null,
): Promise<boolean> {
  if (authToken.peek() === null || currentUser.peek()?.id !== keys.userId) {
    return false;
  }
  generation++;
  setHeld(keys);
  pendingSetup = null;
  pendingRecovery = null;
  pendingRenewal = null;
  scannedSecretKey = null;
  keyState.value = "unlocked";
  // Without the day on which the session ends, the device could not tell when
  // to remove them by itself. Thus, it keeps them only in memory.
  if (endsAt !== null && (await saveDeviceKeys({ ...keys, endsAt }))) {
    announce();
  }
  return true;
}

function forget(): void {
  setHeld(null);
  served = null;
  pendingSetup = null;
  pendingRecovery = null;
  pendingRenewal = null;
}

/**
 * Decides the state for the person who is signed in now: unlocked from what the
 * device has, or else what the server says that the account has. Runs when the
 * session changes, and again from the screens that offer a retry.
 */
export async function checkAccountKeys(): Promise<void> {
  const run = ++generation;
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
  if (held?.userId === user.id) {
    keyState.value = "unlocked";
    return;
  }
  forget();
  keyState.value = "checking";
  const stored = await loadDeviceKeys();
  if (run !== generation) return;
  if (stored) {
    // Kept only for their account, and only until the day when its session
    // would have ended. A device that was off never heard it end.
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
 * What a tab tells the others: the copy of the device was written (`held`), or
 * the keys of the account were removed and it starts again (`gone`).
 */
type Announcement = "held" | "gone";

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
  const mine = held;
  if (mine !== null && said !== "gone") {
    const stored = await loadDeviceKeys();
    if (held !== mine) {
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

const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("manifesto:keys");
if (channel) {
  channel.onmessage = (event) => {
    void heardFromAnotherTab(event.data);
  };
}

function announce(said: Announcement = "held"): void {
  channel?.postMessage(said);
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
  scannedSecretKey = key;
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
    pendingSetup ??= await createAccountKeys(user.id);
  } catch {
    return null;
  }
  return sheet(pendingSetup.secretKey, pendingSetup.recoveryKey);
}

/**
 * Stores the keys that `prepareSetup` made. `exists` means that a different
 * device set up the account in the meantime, and this device now asks for the
 * key of that device.
 */
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
  const kept = await hold(
    {
      userId: user.id,
      version: made.version,
      secretKey: made.secretKey,
      accountKey: made.accountKey,
    },
    served?.sessionEndsAt ?? null,
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
    // A scanned key that does not open is not tried again automatically.
    scannedSecretKey = null;
    return "wrong";
  }
  const kept = await hold(
    { userId: user.id, version: keys.version, secretKey, accountKey: key },
    served?.sessionEndsAt ?? null,
  );
  return kept ? "ok" : "failed";
}

export type RecoveryResult =
  | { kind: "ok"; sheet: KeySheet }
  | {
      kind:
        | "invalid"
        /** Not the recovery key of this account. */
        | "wrong"
        /** Too many wrong keys. Try again later. */
        | "throttled"
        | "failed";
    };

/**
 * Opens what the server gave, and makes the new keys. Both ways to use the
 * recovery key share it.
 */
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
  // The server accepted the key, and its wrap does not open. Do not trust the
  // key.
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
 * The first step to use the recovery key while signed in, for a person who lost
 * the secret key. It checks the key with the server, and answers a sheet with a
 * new secret key and a new recovery key. Nothing is replaced until
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

/** The same with nobody signed in, by username. The recovery then signs in. */
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
 * The second step. It puts the new keys in place of the keys that the recovery
 * used, and unlocks this device with them. With nobody signed in, it takes the
 * new password and signs in. `used` means that the recovery key was used in the
 * meantime.
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
    return (await hold(keys, served?.sessionEndsAt ?? null)) ? "ok" : "failed";
  }
  const answer = await recoveryRequest<AuthSuccessResponse>("complete", {
    ...body,
    username: pending.username,
    newPassword,
  });
  if (answer.kind === "used" || answer.kind === "wrong") return "used";
  if (answer.kind !== "ok") return "failed";
  // Held before the session starts. Thus, the check that follows the sign-in
  // finds the account unlocked, and asks for nothing.
  generation++;
  setHeld(keys);
  pendingRecovery = null;
  adoptSession(answer.body);
  const now = await fetchKeys();
  if (now) served = now;
  return (await hold(keys, now?.sessionEndsAt ?? null)) ? "ok" : "failed";
}

/** Drops a set-up or a recovery that is not complete. */
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
 * The secret key that this device has, after the server checked the password
 * (or, for an account without one, a recent sign-in). Settings shows it to
 * bring in a different device.
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

/**
 * The wrap that the server has now. The secret key here must open it before the
 * code can wrap anything again.
 */
async function currentKeys(): Promise<AccountKeys | null> {
  const answer = await fetchKeys();
  if (answer) served = answer;
  return answer?.keys ?? null;
}

/**
 * Makes a new secret key in place of the key that this device has, after the
 * server checked the password, and answers it to show. Nothing is replaced
 * until `completeRenewal`, after the user says that they kept it.
 */
export async function prepareSecretKey(
  password: string,
): Promise<Confirmed<{ secretKey: string }>> {
  const made = await prepareRenewal(password, replaceSecretKey);
  if (made.kind !== "ok") return made;
  pendingRenewal = { kind: "secret", ...made.next };
  return { kind: "ok", secretKey: made.next.secretKey };
}

/** The same for a new recovery key. */
export async function prepareRecoveryKey(
  password: string,
): Promise<Confirmed<{ recoveryKey: string }>> {
  const made = await prepareRenewal(password, replaceRecoveryKey);
  if (made.kind !== "ok") return made;
  pendingRenewal = { kind: "recovery", ...made.next };
  return { kind: "ok", recoveryKey: made.next.recoveryKey };
}

async function prepareRenewal<T>(
  password: string,
  replace: (
    userId: string,
    keys: AccountKeys,
    secretKey: string,
  ) => Promise<T | null>,
): Promise<Confirmed<{ next: T }>> {
  pendingRenewal = null;
  const mine = held;
  if (!mine) return { kind: "failed" };
  const confirmed = await apiFetch(
    "POST",
    "/auth/keys/confirm",
    withPassword(password),
  );
  if (!confirmed?.ok) return refusalOf(confirmed);
  const keys = await currentKeys();
  if (!keys) return { kind: "failed" };
  let next: T | null;
  try {
    next = await replace(mine.userId, keys, mine.secretKey);
  } catch {
    return { kind: "failed" };
  }
  return next === null ? { kind: "failed" } : { kind: "ok", next };
}

/**
 * Puts the key that `prepareSecretKey` or `prepareRecoveryKey` made in place of
 * the old key. A new secret key signs out each other device, and this device
 * continues with it.
 */
export async function completeRenewal(
  password: string,
): Promise<Confirmed<object>> {
  const pending = pendingRenewal;
  const mine = held;
  if (!pending || !mine) return { kind: "failed" };
  if (pending.kind === "recovery") {
    const res = await apiFetch("POST", "/auth/keys/recovery", {
      ...withPassword(password),
      wrappedByRecovery: pending.wrappedByRecovery,
      recoveryVerifier: pending.recoveryVerifier,
    });
    if (!res?.ok) return refusalOf(res);
    pendingRenewal = null;
    return { kind: "ok" };
  }
  const res = await apiFetch("POST", "/auth/keys/secret", {
    ...withPassword(password),
    wrappedBySecret: pending.wrappedBySecret,
  });
  // A request whose answer was lost can still have occurred. The wrap that the
  // server has tells, and this device must continue with the key that opens it.
  const made =
    res?.ok ||
    (!res &&
      (await currentKeys())?.wrappedBySecret === pending.wrappedBySecret);
  if (!made) return refusalOf(res);
  pendingRenewal = null;
  await hold(
    { ...mine, secretKey: pending.secretKey },
    served?.sessionEndsAt ?? null,
  );
  return { kind: "ok" };
}

/** Drops a new key whose sheet was not kept. The old key continues to work. */
export function abandonRenewal(): void {
  pendingRenewal = null;
}

/** A sheet for one new key, to save next to the old key or in its place. */
export function sheetFor(key: {
  secretKey?: string;
  recoveryKey?: string;
}): KeySheet {
  return sheet(key.secretKey ?? null, key.recoveryKey ?? null);
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
