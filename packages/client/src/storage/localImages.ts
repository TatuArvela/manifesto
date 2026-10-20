import { LOCAL_IMAGE_REF_PREFIX } from "@manifesto/shared";
import { isQuotaError, reportQuotaRefusal } from "./quota.ts";

/**
 * The images of open mode, in IndexedDB, not inside the notes in
 * `localStorage`. `localStorage` has approximately 5 MB for the full site, and
 * only strings. Thus, a few photos as base64 filled it, and then each save
 * failed, also for text. IndexedDB stores the bytes as they are, and gets a
 * part of the disk. A note refers to an image as `local:<sha256>`. Thus, the
 * same image attached two times is stored one time.
 *
 * The first stored image asks the browser to keep the storage of this site
 * persistent (`navigator.storage.persist()`). In open mode, it is the only
 * copy, and a browser that makes space free would otherwise take it.
 */

const DB_NAME = "manifesto-images";
const STORE = "images";

interface StoredImage {
  hash: string;
  blob: Blob;
  /**
   * When the image was last stored, not first. An attach of an image that is
   * already here starts its grace period again (see `sweepLocalImages`).
   */
  createdAt: number;
}

let opening: Promise<IDBDatabase> | null = null;
let askedToPersist = false;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "hash" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

function request<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? req.error);
      }),
  );
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Stores an image, and resolves its `local:` reference. An image that is
 * already stored is written again anyway, to give it a new stamp. It can be an
 * image to which no note refers now, attached now to a draft. With its old
 * stamp, the next sweep could take it from under that draft.
 */
export async function putLocalImage(blob: Blob): Promise<string> {
  const hash = await sha256(blob);
  const existing = await request("readonly", (s) => s.getKey(hash));
  try {
    await request("readwrite", (s) =>
      s.put({ hash, blob, createdAt: Date.now() } satisfies StoredImage),
    );
  } catch (err) {
    if (isQuotaError(err)) reportQuotaRefusal();
    throw err;
  }
  if (existing === undefined) {
    if (!askedToPersist) {
      askedToPersist = true;
      void navigator.storage?.persist?.().catch(() => false);
    }
  }
  return `${LOCAL_IMAGE_REF_PREFIX}${hash}`;
}

/** The bytes that a `local:` reference names. Rejects if they are gone. */
export async function getLocalImage(ref: string): Promise<Blob> {
  const hash = ref.slice(LOCAL_IMAGE_REF_PREFIX.length);
  const found = (await request("readonly", (s) => s.get(hash))) as
    | StoredImage
    | undefined;
  if (!found) throw new Error("The image is no longer stored");
  return found.blob;
}

/**
 * Deletes images to which no note refers now and that are older than `graceMs`:
 * a note deleted permanently, an image removed from a note. The grace period
 * keeps an image just attached to a draft that is not saved yet. Resolves with
 * how many it deleted.
 */
export async function sweepLocalImages(
  referenced: Set<string>,
  graceMs: number,
  now = Date.now(),
): Promise<number> {
  const all = (await request("readonly", (s) => s.getAll())) as StoredImage[];
  const stale = all.filter(
    (image) =>
      !referenced.has(`${LOCAL_IMAGE_REF_PREFIX}${image.hash}`) &&
      now - image.createdAt > graceMs,
  );
  for (const image of stale) {
    await request("readwrite", (s) => s.delete(image.hash));
  }
  return stale.length;
}

export async function clearLocalImages(): Promise<void> {
  await request("readwrite", (s) => s.clear());
}
