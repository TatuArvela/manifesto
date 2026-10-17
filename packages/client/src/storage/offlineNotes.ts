import { associatedData, seal, unsealText, utf8 } from "@manifesto/shared";
import { accountSubkey } from "#/utils/keyMaterial.ts";
import type { StorageKeys } from "./sealing.ts";

/**
 * What this device keeps of notes that are not stored yet: the new-note
 * composer's draft, and notes written while the server could not be reached,
 * waiting to be sent (`state/composerDraft.ts`, `state/unsentNotes.ts`).
 *
 * In connected mode every record is sealed under a key derived from the
 * account key, bound to the account, its key version and the record, so the
 * device holds no note's words readable. A session the server ended leaves
 * the records where they are, unreadable until the account is unlocked here
 * again, so that nothing written offline is lost to a session running out;
 * signing out deletes them. In open mode, where the notes themselves are kept
 * readable in this browser, the records are too.
 *
 * Plain IndexedDB: this runs at sign-out in the entry bundle. Nothing here
 * rejects; a browser that refuses IndexedDB keeps nothing, and the caller
 * holds what it has in memory.
 */

const DB_NAME = "manifesto-offline";
const STORE = "records";

/** The two things kept: the composer's draft, and notes waiting to be sent. */
export type OfflineKind = "draft" | "unsent";

/**
 * Whose records these are. `keys` seals them in connected mode; in open mode
 * it is null and `id` is {@link openModeOwner}.
 */
export interface OfflineOwner {
  id: string;
  keys: StorageKeys | null;
}

let openModeId = "open";

/** The owner of what is kept in open mode, where there is no account. */
export function openModeOwner(): OfflineOwner {
  return { id: openModeId, keys: null };
}

/**
 * Test seam: browser test files run side by side in frames of one origin,
 * which share one IndexedDB, so each keeps open mode's records apart under a
 * name of its own, or a draft one file left would open in another.
 */
export function setOpenModeOwnerForTests(id: string): void {
  openModeId = id;
}

interface StoredRecord {
  key: string;
  owner: string;
  kind: OfflineKind;
  id: string;
  /** Sealed in connected mode; JSON in open mode. */
  value: string;
}

/** A record as kept, opened. */
export interface OfflineRecord {
  id: string;
  value: unknown;
}

function available(): boolean {
  return typeof indexedDB !== "undefined";
}

function recordKey(owner: string, kind: OfflineKind, id: string): string {
  return `${owner}\n${kind}\n${id}`;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "key" });
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

function isStoredRecord(value: unknown): value is StoredRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === "string" &&
    typeof v.owner === "string" &&
    (v.kind === "draft" || v.kind === "unsent") &&
    typeof v.id === "string" &&
    typeof v.value === "string"
  );
}

/** A key for this job alone, derived when first asked for each account key. */
const sealingKeys = new WeakMap<CryptoKey, Promise<CryptoKey>>();

function sealingKey(keys: StorageKeys): Promise<CryptoKey> {
  let key = sealingKeys.get(keys.accountKey);
  if (!key) {
    key = accountSubkey(keys.accountKey, "drafts");
    sealingKeys.set(keys.accountKey, key);
  }
  return key;
}

function dataFor(keys: StorageKeys, kind: OfflineKind, id: string) {
  return associatedData({
    id,
    field: `offline/${kind}`,
    version: keys.version,
    account: keys.userId,
  });
}

/** Serializes `value` as the owner keeps it: sealed, or as it is. */
export async function sealOffline(
  owner: OfflineOwner,
  kind: OfflineKind,
  id: string,
  value: unknown,
): Promise<string> {
  const json = JSON.stringify(value);
  if (!owner.keys) return json;
  return seal(
    await sealingKey(owner.keys),
    utf8(json),
    dataFor(owner.keys, kind, id),
  );
}

/** What {@link sealOffline} made, or null when it does not open for `owner`. */
export async function openOffline(
  owner: OfflineOwner,
  kind: OfflineKind,
  id: string,
  stored: string,
): Promise<unknown> {
  let json: string = stored;
  if (owner.keys) {
    const text = await unsealText(
      await sealingKey(owner.keys),
      stored,
      dataFor(owner.keys, kind, id),
    );
    if (text === null) return null;
    json = text;
  }
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/** Keeps `value` on this device; false when it could not be. */
export async function keepOffline(
  owner: OfflineOwner,
  kind: OfflineKind,
  id: string,
  value: unknown,
): Promise<boolean> {
  if (!available()) return false;
  try {
    const record: StoredRecord = {
      key: recordKey(owner.id, kind, id),
      owner: owner.id,
      kind,
      id,
      value: await sealOffline(owner, kind, id, value),
    };
    await run("readwrite", (store) => store.put(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * The owner's records of `kind` that open. One that does not (sealed under a
 * key the account no longer has) is left out and left in place.
 */
export async function readOffline(
  owner: OfflineOwner,
  kind: OfflineKind,
): Promise<OfflineRecord[]> {
  if (!available()) return [];
  let all: unknown[];
  try {
    all = await run("readonly", (store) => store.getAll());
  } catch {
    return [];
  }
  const out: OfflineRecord[] = [];
  for (const record of all) {
    if (!isStoredRecord(record)) continue;
    if (record.owner !== owner.id || record.kind !== kind) continue;
    const value = await openOffline(owner, kind, record.id, record.value);
    if (value !== null) out.push({ id: record.id, value });
  }
  return out;
}

/** Removes one record. */
export async function dropOffline(
  ownerId: string,
  kind: OfflineKind,
  id: string,
): Promise<void> {
  if (!available()) return;
  try {
    await run("readwrite", (store) =>
      store.delete(recordKey(ownerId, kind, id)),
    );
  } catch {
    // Nothing to remove it from.
  }
}

/** Removes every record of `ownerId`, or every record there is. */
export async function dropAllOffline(ownerId?: string): Promise<void> {
  if (!available()) return;
  try {
    if (ownerId === undefined) {
      await run("readwrite", (store) => store.clear());
      return;
    }
    const all = await run("readonly", (store) => store.getAll());
    const keys = all
      .filter(isStoredRecord)
      .filter((r) => r.owner === ownerId)
      .map((r) => r.key);
    if (keys.length === 0) return;
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        for (const key of keys) store.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Nothing to remove them from.
  }
}

/**
 * Every image reference the records kept in open mode name, so that the
 * sweep of images no note refers to spares a draft's. Empty when they cannot
 * be read.
 */
export async function openModeImageRefs(): Promise<string[]> {
  const owner = openModeOwner();
  const refs: string[] = [];
  for (const kind of ["draft", "unsent"] as const) {
    for (const { value } of await readOffline(owner, kind)) {
      if (typeof value !== "object" || value === null) continue;
      const v = value as { images?: unknown; linkPreviews?: unknown };
      if (Array.isArray(v.images)) {
        refs.push(...v.images.filter((r) => typeof r === "string"));
      }
      if (Array.isArray(v.linkPreviews)) {
        for (const p of v.linkPreviews as { image?: unknown }[]) {
          if (typeof p?.image === "string") refs.push(p.image);
        }
      }
    }
  }
  return refs;
}
