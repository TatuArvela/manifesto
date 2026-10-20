import { computed, signal } from "@preact/signals";
import { LocalStorageAdapter } from "./LocalStorageAdapter.ts";
import { RestApiAdapter } from "./RestApiAdapter.ts";
import type { StorageAdapter } from "./StorageAdapter.ts";
import { sealer } from "./sealing.ts";

export { LocalStorageAdapter } from "./LocalStorageAdapter.ts";
export { RestApiAdapter } from "./RestApiAdapter.ts";
export type { StorageAdapter } from "./StorageAdapter.ts";

/** What is necessary to reach a server, if there is one. */
export interface StorageConnection {
  serverUrl: string | null;
  token: string | null;
  /** Called when the server refuses the token. */
  onUnauthorized?: () => void;
}

/**
 * Set by `state/account/auth.ts`, the module that knows about sessions. Pushed
 * in, not read out. Thus, storage, the bottom layer of the app, never imports
 * one of its own callers. If it did, all code that touched a note would bring
 * in the state of the login screen with it.
 */
export const storageConnection = signal<StorageConnection>({
  serverUrl: null,
  token: null,
});

/**
 * A reactive adapter that computes again when the connection changes. Read
 * `currentStorage.value` at call time. Thus, actions always use the correct
 * backend after a login or logout.
 */
export const currentStorage = computed<StorageAdapter>(() => {
  const { serverUrl, token, onUnauthorized } = storageConnection.value;
  // `=== null`, not falsiness. The base of a same-origin deployment is the
  // empty string. When the code read that as "no server", it sent each note to
  // localStorage while the user thought that they were signed in.
  if (serverUrl !== null && token) {
    // Without the keys of the account (locked, or not set up yet), the adapter
    // still reaches the server, and refuses each note, because it could neither
    // open nor seal it.
    return new RestApiAdapter(serverUrl, token, {
      onUnauthorized,
      sealer: sealer.value,
    });
  }
  return new LocalStorageAdapter();
});

/**
 * The adapter in use at the moment of each call. The code looks up each method
 * on `currentStorage.value` when it is called. Thus, a module can keep this for
 * its full life, and still reach the correct backend after a login or logout.
 */
export const storage: StorageAdapter = new Proxy({} as StorageAdapter, {
  get(_, key) {
    const adapter = currentStorage.value;
    const member = adapter[key as keyof StorageAdapter];
    return typeof member === "function" ? member.bind(adapter) : member;
  },
});
