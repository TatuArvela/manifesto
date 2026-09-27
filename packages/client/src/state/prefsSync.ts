import type { AccountPrefs, AccountPrefsResponse } from "@manifesto/shared";
import { effect, untracked } from "@preact/signals";
import { apiFetch } from "../storage/apiRequest.js";
import { storageConnection } from "../storage/index.js";
import {
  ACCOUNT_PREF_KEYS,
  accountPrefsSnapshot,
  adoptAccountPrefs,
  isApplyingRemotePrefs,
} from "./prefs.js";

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

async function push(): Promise<void> {
  if (!ready || dirty.size === 0) return;
  const snapshot = accountPrefsSnapshot();
  const patch: AccountPrefs = {};
  for (const key of dirty) patch[key] = snapshot[key];
  const res = await apiFetch("PATCH", "/auth/me/prefs", { prefs: patch });
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
 * Reads the server's copy and adopts it: at sign-in, and again after the app
 * socket reconnects, since a change made elsewhere meanwhile was never heard.
 * Never rejects.
 */
export async function refreshAccountPrefs(): Promise<void> {
  const res = await apiFetch("GET", "/auth/me/prefs");
  if (!res?.ok) return;
  let prefs: AccountPrefs;
  try {
    prefs = ((await res.json()) as AccountPrefsResponse).prefs ?? {};
  } catch {
    return;
  }
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return;
  adopt(prefs);
  // The keys the server lacks: every one for an account with nothing stored,
  // or a preference newer than the client that last wrote.
  for (const key of ACCOUNT_PREF_KEYS) {
    if (!(key in prefs)) dirty.add(key);
  }
  ready = true;
  if (dirty.size > 0) schedulePush();
}

/** `prefs:updated` from the app socket: another device changed something. */
export function receiveAccountPrefs(prefs: AccountPrefs): void {
  if (!ready) return;
  adopt(prefs);
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
    untracked(() => {
      ready = false;
      dirty.clear();
      clearTimeout(pushTimer);
      if (serverUrl === null || !token) return;
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
