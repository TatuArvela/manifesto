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
 * Pushed in rather than read out: storage used to import the auth signals
 * directly, which put the bottom layer of the app above one of its own
 * callers and meant anything touching a note pulled the login screen's state
 * in with it.
 */
export const storageConnection = signal<StorageConnection>({
  serverUrl: null,
  token: null,
});

/**
 * Reactive adapter — recomputes when the connection changes. Read
 * `currentStorage.value` at call time so actions always hit the right backend
 * after a login or logout.
 */
export const currentStorage = computed<StorageAdapter>(() => {
  const { serverUrl, token, onUnauthorized } = storageConnection.value;
  if (serverUrl && token) {
    return new RestApiAdapter(serverUrl, token, { onUnauthorized });
  }
  return new LocalStorageAdapter();
});

/**
 * Thin shim used by tests and modules that want a plain object. Reads through
 * to the latest reactive adapter on every method call.
 */
export function createStorage(): StorageAdapter {
  return {
    getAll: () => currentStorage.value.getAll(),
    get: (id) => currentStorage.value.get(id),
    create: (note) => currentStorage.value.create(note),
    update: (id, changes, options) =>
      currentStorage.value.update(id, changes, options),
    delete: (id) => currentStorage.value.delete(id),
    deleteAll: () => currentStorage.value.deleteAll(),
    search: (query) => currentStorage.value.search(query),
    importAll: (notes) => currentStorage.value.importAll(notes),
    loadImages: (id) => currentStorage.value.loadImages(id),
  };
}
