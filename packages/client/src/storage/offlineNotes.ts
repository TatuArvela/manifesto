import {
  associatedData,
  currentNoteFormat,
  isNewerNoteFormat,
  seal,
  unsealText,
  utf8,
} from "@manifesto/shared";
import { accountSubkey } from "#/utils/keyMaterial.ts";
import type { StorageKeys } from "./sealing.ts";

/**
 * What this device keeps of notes that are not stored yet: the draft of the
 * new-note composer, and notes written while the server was not available,
 * which wait to be sent (`state/composerDraft.ts`, `state/unsentNotes.ts`).
 *
 * In connected mode, each record is sealed under a key derived from the account
 * key, bound to the account, its key version and the record. Thus, the device
 * has the words of no note readable. A session that the server ended leaves the
 * records where they are, unreadable until the account is unlocked here again.
 * Thus, nothing written offline is lost when a session ends. A sign-out deletes
 * them. In open mode, the notes themselves are kept readable in this browser,
 * and so are the records.
 *
 * Plain IndexedDB, because this runs at sign-out in the entry bundle. Nothing
 * here rejects. A browser that refuses IndexedDB keeps nothing, and the caller
 * keeps what it has in memory.
 */

const DB_NAME = "manifesto-offline";
const STORE = "records";

/**
 * The two things kept: the draft of the composer, and notes that wait to be
 * sent.
 */
export type OfflineKind = "draft" | "unsent";

/**
 * The owner of these records. `keys` seals them in connected mode. In open
 * mode, it is null and `id` is {@link openModeOwner}.
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
 * Test seam. Browser test files run in parallel in frames of one origin, which
 * share one IndexedDB. Thus, each keeps the records of open mode separate under
 * its own name. If not, a draft that one file left would open in a different
 * file.
 */
export function setOpenModeOwnerForTests(id: string): void {
  openModeId = id;
}

interface StoredRecord {
  key: string;
  owner: string;
  kind: OfflineKind;
  id: string;
  /** Sealed in connected mode. JSON in open mode. */
  value: string;
  /**
   * The format of the words of the note in it (`noteFormat.ts` in shared).
   * Absent in a record kept before formats were recorded, which is format 1.
   */
  format?: number;
}

/**
 * A record as kept, opened. The code that reads its value updates the words in
 * it from `format`.
 */
export interface OfflineRecord {
  id: string;
  value: unknown;
  format: number;
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
    typeof v.value === "string" &&
    (v.format === undefined || typeof v.format === "number")
  );
}

/**
 * A key only for this job, derived the first time that code asks for it for
 * each account key.
 */
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

/** Keeps `value` on this device. False when that was not possible. */
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
      format: currentNoteFormat(),
    };
    await run("readwrite", (store) => store.put(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * The records of `kind` of the owner that open. The code does not include, and
 * does not move, a record that does not open (sealed under a key that the
 * account does not have now). The same applies to a record that a newer version
 * of the app kept, which this version would read incorrectly.
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
    const format = record.format ?? 1;
    if (isNewerNoteFormat(format)) continue;
    const value = await openOffline(owner, kind, record.id, record.value);
    if (value !== null) out.push({ id: record.id, value, format });
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
    // Nothing from which to remove it.
  }
}

/** Removes each record of `ownerId`, or each record that there is. */
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
    // Nothing from which to remove them.
  }
}

/**
 * Each image reference that the records kept in open mode name. Thus, the sweep
 * of images to which no note refers keeps those of a draft. Empty when the code
 * cannot read them.
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
