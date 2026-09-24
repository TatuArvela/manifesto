import { computed, signal } from "@preact/signals";
import { LocalStorageAdapter } from "./LocalStorageAdapter.js";
import { RestApiAdapter } from "./RestApiAdapter.js";
import type { StorageAdapter } from "./StorageAdapter.js";

export { LocalStorageAdapter } from "./LocalStorageAdapter.js";
export { RestApiAdapter } from "./RestApiAdapter.js";
export type { StorageAdapter } from "./StorageAdapter.js";

/** What it takes to reach a server, if there is one to reach. */
export interface StorageConnection {
  serverUrl: string | null;
  token: string | null;
  /** Called when the server rejects the token. */
  onUnauthorized?: () => void;
}

/**
 * Set by `state/auth.ts`, which is the module that knows about sessions.
 * Pushed in rather than read out, so storage, the bottom layer of the app,
 * never imports one of its own callers: anything touching a note would pull
 * the login screen's state in with it.
 */
export const storageConnection = signal<StorageConnection>({
  serverUrl: null,
  token: null,
});

/**
 * Reactive adapter that recomputes when the connection changes. Read
 * `currentStorage.value` at call time so actions always hit the right backend
 * after a login or logout.
 */
export const currentStorage = computed<StorageAdapter>(() => {
  const { serverUrl, token, onUnauthorized } = storageConnection.value;
  // `=== null`, not falsiness: a same-origin deployment's base is the empty
  // string, and reading that as "no server" sent every note to localStorage
  // while the user believed they were signed in.
  if (serverUrl !== null && token) {
    return new RestApiAdapter(serverUrl, token, { onUnauthorized });
  }
  return new LocalStorageAdapter();
});

/**
 * The adapter in use at the moment of each call. Every method is looked up on
 * `currentStorage.value` when it is called, so a module can hold this for its
 * whole life and still reach the right backend after a login or logout.
 */
export const storage: StorageAdapter = new Proxy({} as StorageAdapter, {
  get(_, key) {
    const adapter = currentStorage.value;
    const member = adapter[key as keyof StorageAdapter];
    return typeof member === "function" ? member.bind(adapter) : member;
  },
});
