/**
 * The keys a signed-in device holds, in IndexedDB: the secret key, so that
 * Settings can show it to bring another device in, and the account key as a
 * `CryptoKey` the page (and the service worker) can use and cannot read out.
 * IndexedDB rather than `localStorage` because only it stores such a key.
 *
 * A device holds them for as long as it is signed in and no longer: whoever
 * ends the session removes them (`state/accountKeys.ts`), and `endsAt` is the
 * day the session runs out at the latest, so a device that was off when that
 * happened removes them itself the next time it starts.
 *
 * Nothing here rejects. A browser that refuses IndexedDB (some private
 * windows) leaves the keys in the page's memory alone, and the secret key is
 * asked for again on the next visit.
 */

const DB_NAME = "manifesto-keys";
const STORE = "keys";
/** One account is signed in at a time, so there is one record. */
const RECORD = "account";

export interface DeviceKeys {
  userId: string;
  /** Which account key this is. */
  version: number;
  secretKey: string;
  accountKey: CryptoKey;
  /** ISO time after which the keys are not to be used. */
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

/** Keeps the keys on this device; false when the browser would not. */
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
    // Nothing to remove them from.
  }
}
