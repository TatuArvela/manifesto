/**
 * One object store in its own IndexedDB database. All modules that keep data
 * on the device in IndexedDB go through this. Thus, they open, upgrade, fail
 * and close in the same way.
 *
 * - An open that a different tab blocks rejects. It does not wait forever.
 *   If the open then completes after all, the connection closes at once.
 * - Each connection closes when a different tab asks for a newer version
 *   (`onversionchange`). If not, a future upgrade waits until all tabs close.
 * - A transaction resolves when it completes, not when its request succeeds.
 *   Thus, a write that resolves is on the disk.
 *
 * By default, each call opens the database, runs one transaction and closes
 * it. `keepOpen` keeps one connection for the page, for a store that the board
 * reads many times (the images of open mode). The kept connection opens again
 * after it closes or fails.
 */

export interface IdbStore {
  /** Runs one transaction on the store, and resolves with the request result. */
  run<T>(
    mode: IDBTransactionMode,
    use: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T>;
  /**
   * Runs one transaction that can make many requests, and resolves when it
   * completes.
   */
  runAll(
    mode: IDBTransactionMode,
    use: (store: IDBObjectStore) => void,
  ): Promise<void>;
}

interface IdbStoreOptions {
  /** The key path of the store. Without it, each write gives its key. */
  keyPath?: string | undefined;
  /** Keeps one connection for the page. */
  keepOpen?: boolean | undefined;
}

export function idbStore(
  dbName: string,
  storeName: string,
  options: IdbStoreOptions = {},
): IdbStore {
  let kept: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(
          storeName,
          options.keyPath === undefined ? {} : { keyPath: options.keyPath },
        );
      };
      req.onsuccess = () => {
        const db = req.result;
        if (settled) {
          db.close();
          return;
        }
        settled = true;
        db.onversionchange = () => {
          db.close();
          kept = null;
        };
        // The browser closed it (the site data was cleared, for example).
        db.onclose = () => {
          kept = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        settled = true;
        reject(req.error);
      };
      req.onblocked = () => {
        settled = true;
        reject(new Error(`IndexedDB ${dbName} is blocked`));
      };
    });

  const connect = (): Promise<IDBDatabase> => {
    if (!options.keepOpen) return open();
    kept ??= open().catch((err: unknown) => {
      kept = null;
      throw err;
    });
    return kept;
  };

  const transact = async <T>(
    mode: IDBTransactionMode,
    use: (store: IDBObjectStore) => IDBRequest<T> | undefined,
  ): Promise<T | undefined> => {
    const db = await connect();
    try {
      return await new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const req = use(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error ?? req?.error);
        tx.onabort = () => reject(tx.error ?? req?.error);
      });
    } finally {
      if (!options.keepOpen) db.close();
    }
  };

  return {
    run<T>(
      mode: IDBTransactionMode,
      use: (store: IDBObjectStore) => IDBRequest<T>,
    ): Promise<T> {
      // `use` gives a request. Thus, the result is that of the request.
      return transact(mode, use) as Promise<T>;
    },
    runAll: async (mode, use) => {
      await transact(mode, (store) => {
        use(store);
        return undefined;
      });
    },
  };
}
