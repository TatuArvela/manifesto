import { computed } from "@preact/signals";
import { authToken, clearAuthLocal, SERVER_URL } from "../state/auth.js";
import { LocalStorageAdapter } from "./LocalStorageAdapter.js";
import { RestApiAdapter } from "./RestApiAdapter.js";
import type { StorageAdapter } from "./StorageAdapter.js";

export { LocalStorageAdapter } from "./LocalStorageAdapter.js";
export { RestApiAdapter } from "./RestApiAdapter.js";
export type { StorageAdapter } from "./StorageAdapter.js";

/**
 * Reactive adapter — recomputes when auth changes. Reads `currentStorage.value`
 * at call time so actions always hit the right backend after login/logout.
 */
export const currentStorage = computed<StorageAdapter>(() => {
  const url = SERVER_URL;
  const token = authToken.value;
  if (url && token) {
    return new RestApiAdapter(url, token, { onUnauthorized: clearAuthLocal });
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
    update: (id, changes) => currentStorage.value.update(id, changes),
    delete: (id) => currentStorage.value.delete(id),
    deleteAll: () => currentStorage.value.deleteAll(),
    search: (query) => currentStorage.value.search(query),
    importAll: (notes) => currentStorage.value.importAll(notes),
  };
}
