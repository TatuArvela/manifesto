import type {
  AccountPrefs,
  CapabilitiesResponse,
  SealedAccountPrefs,
  SealedAccountPrefsResponse,
} from "@manifesto/shared";
import { effect, untracked } from "@preact/signals";
import { apiFetch } from "../storage/apiRequest.js";
import { storageConnection } from "../storage/index.js";
import { type NoteSealing, sealer } from "../storage/sealing.js";
import {
  ACCOUNT_PREF_KEYS,
  accountPrefsSnapshot,
  adoptAccountPrefs,
  isApplyingRemotePrefs,
} from "./prefs.js";
import { defaultPrefsOf, serverDefaultPrefs } from "./serverDefaults.js";

/**
 * Connected mode keeps the account's preferences on the server, so hidden
 * tags and the rest follow the account from device to device. The ones
 * `prefs.ts` counts as the device's own stay here.
 *
 * On sign-in the server's copy wins for every key it has, and this device
 * fills in the keys it lacks; an account with none stored takes this device's
 * as they are. After that each change here is sent as a patch of the keys it
 * touched, and each change elsewhere arrives as `prefs:updated` on the app
 * socket. A change made here and not yet sent wins over one that arrives,
 * since it is newer to the person making it.
 *
 * The server holds each value sealed under the account's personal key (the
 * names of hidden tags are among them), so nothing here runs until the
 * account is unlocked.
 */

/** Each account key's value as this module last saw it, as JSON. */
let known = new Map<string, string>();
/** Keys changed here and not yet accepted by the server. */
const dirty = new Set<string>();
/** Whether the server's copy has been read this session. Until then a
 * change is only noted, since the server's copy may be about to replace it. */
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
 * Whether `sealing` is still the account's: a lock, an unlock or another
 * account signing in while something was being sealed or opened makes what
 * it was doing another session's business.
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
  // Offline or refused: the keys stay dirty, for the next change or the
  // next time the socket reconnects.
  if (!res?.ok) return;
  for (const [key, value] of Object.entries(patch)) {
    // Changed again while this was in flight: that change still has to go.
    if (JSON.stringify(accountPrefsSnapshot()[key]) === JSON.stringify(value)) {
      dirty.delete(key);
    }
  }
  if (dirty.size > 0) schedulePush();
}

/** Takes the server's copy, keeping what was changed here and not yet sent. */
function adopt(prefs: AccountPrefs) {
  const incoming: AccountPrefs = {};
  for (const [key, value] of Object.entries(prefs)) {
    if (!dirty.has(key)) incoming[key] = value;
  }
  adoptAccountPrefs(incoming);
}

/**
 * The host's default preferences, asking the server for them if it has not
 * been asked yet: an account signing in for the first time may get here
 * before the app's own request for the capabilities has come back. Empty
 * when the server cannot say.
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
 * Reads the server's copy and adopts it: at sign-in, and again after the app
 * socket reconnects, since a change made elsewhere meanwhile was never heard.
 * Never rejects.
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
  // A value that does not open reads as one the server lacks, and is sent
  // again from here.
  const prefs = await sealing.openPrefs(sealed);
  if (!stillCurrent(sealing)) return;
  // The keys the server lacks: every one for an account with nothing stored,
  // or a preference newer than the client that last wrote.
  const missing = ACCOUNT_PREF_KEYS.filter((key) => !(key in prefs));
  const defaults = missing.length > 0 ? await hostDefaults() : {};
  if (!stillCurrent(sealing)) return;
  // Each takes the host's default where there is one, and this device's
  // value where not; either is then stored as the account's own.
  const filled: AccountPrefs = {};
  for (const key of missing) {
    if (key in defaults) filled[key] = defaults[key];
  }
  adopt({ ...filled, ...prefs });
  for (const key of missing) dirty.add(key);
  ready = true;
  if (dirty.size > 0) schedulePush();
}

/** `prefs:updated` from the app socket: another device changed something.
 * Never rejects. */
export async function receiveAccountPrefs(
  sealed: SealedAccountPrefs,
): Promise<void> {
  const sealing = sealer.peek();
  if (!ready || !sealing) return;
  const prefs = await sealing.openPrefs(sealed);
  if (ready && stillCurrent(sealing)) adopt(prefs);
}

/**
 * Starts following the session: reads the server's copy whenever one begins,
 * and sends each change made here. Once per page; open mode never starts it.
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
      if (serverUrl === null || !token || !unlocked) return;
      void refreshAccountPrefs();
    });
  });

  // The first run records where this device stands; after that, a difference
  // is a change made here, unless it came from elsewhere.
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
