/**
 * The board's background picture, kept on this device only.
 *
 * In IndexedDB rather than beside the preferences in `localStorage`: a photo
 * is megabytes even after `shrinkBoardImage`, and the few megabytes
 * `localStorage` has are where the notes themselves live in open mode.
 */

const DB_NAME = "manifesto-board";
const STORE = "images";
const KEY = "background";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = act(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadBoardImage(): Promise<Blob | null> {
  const value = await run("readonly", (store) => store.get(KEY));
  return value instanceof Blob ? value : null;
}

export async function saveBoardImage(image: Blob): Promise<void> {
  await run("readwrite", (store) => store.put(image, KEY));
}

export async function deleteBoardImage(): Promise<void> {
  await run("readwrite", (store) => store.delete(KEY));
}

/** Longest edge kept, in pixels: sharp across a large desktop screen. */
const MAX_EDGE = 2560;

/**
 * Re-encodes a picked picture at no more than `MAX_EDGE` on its longest side,
 * or null if the browser cannot decode it. A phone photo is 4000px and several
 * megabytes, and all of that would be decoded again on every start to paint a
 * background mostly covered by notes.
 */
export async function shrinkBoardImage(file: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (width === 0 || height === 0) return null;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    // WebP where the browser can write it; one that cannot hands back PNG,
    // which for a photo is several times the size, so JPEG instead.
    const webp = await toBlob(canvas, "image/webp");
    if (webp?.type === "image/webp") return webp;
    return await toBlob(canvas, "image/jpeg");
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
}
