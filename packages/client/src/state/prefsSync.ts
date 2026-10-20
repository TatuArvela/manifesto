import type {
  AccountPrefs,
  CapabilitiesResponse,
  SealedAccountPrefs,
  SealedAccountPrefsResponse,
} from "@manifesto/shared";
import { effect, untracked } from "@preact/signals";
import { apiFetch } from "#/storage/apiRequest.ts";
import { storageConnection } from "#/storage/index.ts";
import { type NoteSealing, sealer } from "#/storage/sealing.ts";
import {
  ACCOUNT_PREF_KEYS,
  accountPrefsSnapshot,
  adoptAccountPrefs,
  isApplyingRemotePrefs,
  setAccountPrefsFromServer,
} from "./prefs.ts";
import { defaultPrefsOf, serverDefaultPrefs } from "./serverDefaults.ts";

/**
 * Connected mode keeps the preferences of the account on the server. Thus,
 * hidden tags and the other preferences follow the account from device to
 * device. The preferences that `prefs.ts` counts as those of the device stay
 * here.
 *
 * On sign-in, the copy of the server wins for each key that it has, and this
 * device fills the keys that it does not have. An account with none stored
 * takes those of this device as they are. After that, each change here goes as
 * a patch of the keys that it changed. Each change in a different place arrives
 * as `prefs:updated` on the app socket. A change made here and not sent yet
 * wins over a change that arrives, because it is newer for the person who makes
 * it.
 *
 * The server keeps each value sealed under the personal key of the account (the
 * names of hidden tags are among them). Thus, nothing here runs until the
 * account is unlocked.
 */

/** The value of each account key as this module last saw it, as JSON. */
let known = new Map<string, string>();
/** Keys changed here that the server did not accept yet. */
const dirty = new Set<string>();
/**
 * If the code read the copy of the server in this session. Until then, a change
 * is only recorded, because the copy of the server can replace it soon.
 */
let ready = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

const PUSH_DELAY_MS = 500;

function remember(snapshot: Record<string, unknown>) {
  known = new Map(
    Object.entries(snapshot).map(([key, value]) => [
      key,
      JSON.stringify(value),
    ]),
  );
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), PUSH_DELAY_MS);
}

/**
 * If `sealing` still belongs to the account. A lock, an unlock or a sign-in of
 * a different account during a seal or an open makes that operation part of a
 * different session.
 */
const stillCurrent = (sealing: NoteSealing) => sealer.peek() === sealing;

async function push(): Promise<void> {
  const sealing = sealer.peek();
  if (!ready || dirty.size === 0 || !sealing) return;
  const snapshot = accountPrefsSnapshot();
  const patch: AccountPrefs = {};
  for (const key of dirty) patch[key] = snapshot[key];
  const prefs = await sealing.sealPrefs(patch);
  if (!stillCurrent(sealing)) return;
  const res = await apiFetch("PATCH", "/auth/me/prefs", { prefs });
  // Offline or refused. The keys stay dirty, for the next change or the next
  // reconnect of the socket.
  if (!res?.ok) return;
  for (const [key, value] of Object.entries(patch)) {
    // Changed again while this was in progress. That change must still go.
    if (JSON.stringify(accountPrefsSnapshot()[key]) === JSON.stringify(value)) {
      dirty.delete(key);
    }
  }
  if (dirty.size > 0) schedulePush();
}

/**
 * Takes the copy of the server, and keeps what was changed here and not sent
 * yet.
 */
function adopt(prefs: AccountPrefs) {
  const incoming: AccountPrefs = {};
  for (const [key, value] of Object.entries(prefs)) {
    if (!dirty.has(key)) incoming[key] = value;
  }
  adoptAccountPrefs(incoming);
}

/**
 * The default preferences of the host. The code asks the server for them if it
 * did not ask yet. An account that signs in for the first time can get here
 * before the own request of the app for the capabilities came back. Empty when
 * the server cannot tell.
 */
async function hostDefaults(): Promise<AccountPrefs> {
  const known = serverDefaultPrefs.peek();
  if (known) return known.prefs;
  const res = await apiFetch("GET", "/capabilities");
  if (!res?.ok) return {};
  try {
    const prefs = defaultPrefsOf(
      (await res.json()) as Partial<CapabilitiesResponse>,
    );
    serverDefaultPrefs.value = { prefs, signedIn: true };
    return prefs;
  } catch {
    return {};
  }
}

/**
 * Reads the copy of the server and adopts it: at sign-in, and again after the
 * app socket reconnects, because the code never got a change made in a
 * different place in the meantime. Never rejects.
 */
export async function refreshAccountPrefs(): Promise<void> {
  const sealing = sealer.peek();
  if (!sealing) return;
  const res = await apiFetch("GET", "/auth/me/prefs");
  if (!res?.ok || !stillCurrent(sealing)) return;
  let sealed: SealedAccountPrefs;
  try {
    sealed = ((await res.json()) as SealedAccountPrefsResponse).prefs ?? {};
  } catch {
    return;
  }
  if (!sealed || typeof sealed !== "object" || Array.isArray(sealed)) return;
  // A value that does not open reads as a value that the server does not have,
  // and this client sends it again.
  const prefs = await sealing.openPrefs(sealed);
  if (!stillCurrent(sealing)) return;
  // The keys that the server does not have: each key for an account with
  // nothing stored, or a preference newer than the client that wrote last.
  const missing = ACCOUNT_PREF_KEYS.filter((key) => !(key in prefs));
  const defaults = missing.length > 0 ? await hostDefaults() : {};
  if (!stillCurrent(sealing)) return;
  // Each takes the default of the host where there is one, and the value of
  // this device where not. Either is then stored as the value of the account.
  const filled: AccountPrefs = {};
  for (const key of missing) {
    if (key in defaults) filled[key] = defaults[key];
  }
  adopt({ ...filled, ...prefs });
  for (const key of missing) dirty.add(key);
  ready = true;
  if (dirty.size > 0) schedulePush();
}

/**
 * `prefs:updated` from the app socket: a different device changed something.
 * Never rejects.
 */
export async function receiveAccountPrefs(
  sealed: SealedAccountPrefs,
): Promise<void> {
  const sealing = sealer.peek();
  if (!ready || !sealing) return;
  const prefs = await sealing.openPrefs(sealed);
  if (ready && stillCurrent(sealing)) adopt(prefs);
}

/**
 * Starts to follow the session. It reads the copy of the server each time a
 * session starts, and sends each change made here. One time for each page. Open
 * mode never starts it.
 */
export function startPrefsSync(): void {
  if (started) return;
  started = true;

  effect(() => {
    const { serverUrl, token } = storageConnection.value;
    const unlocked = sealer.value !== null;
    untracked(() => {
      ready = false;
      dirty.clear();
      clearTimeout(pushTimer);
      // When signed in, the copy of the server is read at the unlock. Thus,
      // this tab does not take the account preferences of a different tab now.
      setAccountPrefsFromServer(serverUrl !== null && !!token);
      if (serverUrl === null || !token || !unlocked) return;
      void refreshAccountPrefs();
    });
  });

  // The first run records the state of this device. After that, a difference is
  // a change made here, unless it came from a different place.
  let first = true;
  effect(() => {
    const snapshot = accountPrefsSnapshot();
    if (first || isApplyingRemotePrefs()) {
      first = false;
      remember(snapshot);
      return;
    }
    for (const [key, value] of Object.entries(snapshot)) {
      if (known.get(key) !== JSON.stringify(value)) dirty.add(key);
    }
    remember(snapshot);
    if (ready) untracked(schedulePush);
  });
}
