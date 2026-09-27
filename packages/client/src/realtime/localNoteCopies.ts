/**
 * The offline copies `yjsSession.ts` keeps of each note opened for editing,
 * one IndexedDB database per note (`manifesto:yjs:<id>`). They outlive the
 * session, so signing out deletes them, or the next person at a shared
 * computer can read them.
 *
 * Plain IndexedDB, not y-indexeddb: this runs at sign-out in the entry
 * bundle, which must not pull the collaboration stack in.
 */

export const LOCAL_COPY_PREFIX = "manifesto:yjs:";

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
  const names = new Set(noteIds.map((id) => `${LOCAL_COPY_PREFIX}${id}`));
  try {
    for (const db of (await indexedDB.databases?.()) ?? []) {
      if (db.name?.startsWith(LOCAL_COPY_PREFIX)) names.add(db.name);
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
