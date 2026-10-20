/**
 * The offline copies that `yjsSession.ts` keeps of each note opened for
 * editing, one IndexedDB database for each note (`manifesto:yjs-sealed:<id>`).
 * They stay after the session. Thus, a sign-out deletes them. If not, the next
 * person at a shared computer can have them.
 *
 * Plain IndexedDB, not y-indexeddb. This runs at sign-out in the entry bundle,
 * which must not bring in the collaboration stack.
 */

export const LOCAL_COPY_PREFIX = "manifesto:yjs-sealed:";

/**
 * Where a copy was kept before the shared document was sealed: the document
 * itself, readable. The code never opens the name again, because the data
 * loaded from a copy is synced to the server as it is. It must not start with
 * `LOCAL_COPY_PREFIX`, and the opposite, so that one can be deleted without the
 * other.
 */
const READABLE_COPY_PREFIX = "manifesto:yjs:";

/**
 * Delete each offline copy in this browser. `indexedDB.databases()` finds all
 * of them. `noteIds` covers a browser without it, which can only delete the
 * notes that it gets. Resolves after the code asked for each deletion. It never
 * rejects. A copy that an editor still has open is deleted when it closes.
 */
export async function deleteLocalNoteCopies(
  noteIds: readonly string[],
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await deleteCopies([LOCAL_COPY_PREFIX, READABLE_COPY_PREFIX], noteIds);
}

/**
 * No code makes readable copies now. Thus, after a listing found all of them,
 * there are none left to look for, and a note opened later costs no second
 * pass. Without a listing, each note is deleted one time by its id.
 */
let readableCopiesGone = false;
const readableCopiesDeleted = new Set<string>();

/**
 * Delete each copy from before the shared document was sealed, which contains
 * the text of a note readable, and is of no use now. `noteIds` as above. It
 * never rejects.
 */
export async function deleteReadableNoteCopies(
  noteIds: readonly string[],
): Promise<void> {
  if (typeof indexedDB === "undefined" || readableCopiesGone) return;
  const ids = noteIds.filter((id) => !readableCopiesDeleted.has(id));
  if (ids.length === 0) return;
  for (const id of ids) readableCopiesDeleted.add(id);
  if (await deleteCopies([READABLE_COPY_PREFIX], ids)) {
    readableCopiesGone = true;
  }
}

/** If the browser listed its databases. Thus, the code found each copy. */
async function deleteCopies(
  prefixes: readonly string[],
  noteIds: readonly string[],
): Promise<boolean> {
  const names = new Set(
    prefixes.flatMap((prefix) => noteIds.map((id) => `${prefix}${id}`)),
  );
  let listed = false;
  try {
    const databases = await indexedDB.databases?.();
    for (const db of databases ?? []) {
      const name = db.name;
      if (name !== undefined && prefixes.some((p) => name.startsWith(p))) {
        names.add(name);
      }
    }
    listed = databases !== undefined;
  } catch {
    // Some private modes refuse the listing. The ids still apply.
  }
  await Promise.all([...names].map(deleteDatabase));
  return listed;
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      // Still open in some place. The deletion waits for it. The sign-out does
      // not have to.
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
