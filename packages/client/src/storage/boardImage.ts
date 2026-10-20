/**
 * The background picture of the board, kept only on this device.
 *
 * In IndexedDB, not next to the preferences in `localStorage`. A photo is
 * megabytes also after `shrinkBoardImage`, and the few megabytes that
 * `localStorage` has are where the notes themselves are in open mode.
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

/** The longest edge kept, in pixels: sharp across a large desktop screen. */
const MAX_EDGE = 2560;

/**
 * Encodes a selected picture again at no more than `MAX_EDGE` on its longest
 * side, or null if the browser cannot decode it. A phone photo is 4000px and
 * several megabytes. All of that would be decoded again on each start, to paint
 * a background that notes mostly cover.
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
    // WebP where the browser can write it. A browser that cannot gives back
    // PNG, which for a photo is several times the size. Thus, use JPEG then.
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
