/**
 * The offline copies `yjsSession.ts` keeps of each note opened for editing,
 * one IndexedDB database per note (`manifesto:yjs-sealed:<id>`). They outlive
 * the session, so signing out deletes them, or the next person at a shared
 * computer can hold them.
 *
 * Plain IndexedDB, not y-indexeddb: this runs at sign-out in the entry
 * bundle, which must not pull the collaboration stack in.
 */

export const LOCAL_COPY_PREFIX = "manifesto:yjs-sealed:";

/**
 * Where a copy was kept before the shared document was sealed: the document
 * itself, readable. The name is never opened again, since what is loaded
 * from a copy is synced to the server as it is, and it must not start with
 * `LOCAL_COPY_PREFIX` or the other way round, which is what lets one be
 * deleted without the other.
 */
const READABLE_COPY_PREFIX = "manifesto:yjs:";

/**
 * Delete every offline copy in this browser. `indexedDB.databases()` finds
 * them all; `noteIds` covers a browser without it, which can only delete the
 * notes it is told about. Resolves once each deletion has been asked for;
 * never rejects. A copy an editor still holds open is deleted when it closes.
 */
export async function deleteLocalNoteCopies(
  noteIds: readonly string[],
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await deleteCopies([LOCAL_COPY_PREFIX, READABLE_COPY_PREFIX], noteIds);
}

/**
 * Delete every copy from before the shared document was sealed, which holds
 * a note's text readable and is of no use to anything now. `noteIds` as
 * above. Never rejects.
 */
export async function deleteReadableNoteCopies(
  noteIds: readonly string[],
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await deleteCopies([READABLE_COPY_PREFIX], noteIds);
}

async function deleteCopies(
  prefixes: readonly string[],
  noteIds: readonly string[],
): Promise<void> {
  const names = new Set(
    prefixes.flatMap((prefix) => noteIds.map((id) => `${prefix}${id}`)),
  );
  try {
    for (const db of (await indexedDB.databases?.()) ?? []) {
      const name = db.name;
      if (name !== undefined && prefixes.some((p) => name.startsWith(p))) {
        names.add(name);
      }
    }
  } catch {
    // Listing is refused in some private modes; the ids still apply.
  }
  await Promise.all([...names].map(deleteDatabase));
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      // Still open somewhere: the deletion waits for it, sign-out need not.
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
