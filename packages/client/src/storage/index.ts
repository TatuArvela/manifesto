export { LocalStorageAdapter } from "./LocalStorageAdapter.js";
export { RestApiAdapter } from "./RestApiAdapter.js";
export type { StorageAdapter } from "./StorageAdapter.js";

import { LocalStorageAdapter } from "./LocalStorageAdapter.js";
import type { StorageAdapter } from "./StorageAdapter.js";

/**
 * Factory for creating the appropriate storage adapter.
 * Currently returns LocalStorageAdapter; swap to RestApiAdapter
 * when server connection is configured.
 */
export function createStorage(): StorageAdapter {
  return new LocalStorageAdapter();
}
