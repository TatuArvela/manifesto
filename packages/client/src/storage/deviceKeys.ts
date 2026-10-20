/**
 * The keys that a signed-in device has, in IndexedDB. The secret key is there,
 * so that Settings can show it to bring in a different device. The account key
 * is there as a `CryptoKey` that the page (and the service worker) can use, and
 * cannot read out. IndexedDB, not `localStorage`, because only it stores such a
 * key.
 *
 * A device keeps them only while it is signed in. The code that ends the
 * session removes them (`state/account/accountKeys.ts`). `endsAt` is the latest
 * day on which the session ends. Thus, a device that was off when that occurred
 * removes them itself the next time it starts.
 *
 * Nothing here rejects. A browser that refuses IndexedDB (some private windows)
 * keeps the keys only in the memory of the page, and asks for the secret key
 * again on the next visit.
 */

const DB_NAME = "manifesto-keys";
const STORE = "keys";
/** One account is signed in at a time. Thus, there is one record. */
const RECORD = "account";

export interface DeviceKeys {
  userId: string;
  /** Which account key this is. */
  version: number;
  secretKey: string;
  accountKey: CryptoKey;
  /** The ISO time after which the keys must not be used. */
  endsAt: string;
}

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = use(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? req.error);
    });
  } finally {
    db.close();
  }
}

function isDeviceKeys(value: unknown): value is DeviceKeys {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    typeof v.version === "number" &&
    typeof v.secretKey === "string" &&
    typeof v.endsAt === "string" &&
    typeof CryptoKey !== "undefined" &&
    v.accountKey instanceof CryptoKey
  );
}

/** Keeps the keys on this device. False when the browser would not. */
export async function saveDeviceKeys(keys: DeviceKeys): Promise<boolean> {
  if (!available()) return false;
  try {
    await run("readwrite", (store) => store.put(keys, RECORD));
    return true;
  } catch {
    return false;
  }
}

/** The keys kept on this device, or null when there are none to read. */
export async function loadDeviceKeys(): Promise<DeviceKeys | null> {
  if (!available()) return null;
  try {
    const stored = await run("readonly", (store) => store.get(RECORD));
    return isDeviceKeys(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Removes the keys from this device. */
export async function clearDeviceKeys(): Promise<void> {
  if (!available()) return;
  try {
    await run("readwrite", (store) => store.delete(RECORD));
  } catch {
    // Nothing from which to remove them.
  }
}
