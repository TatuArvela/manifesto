import { MAX_NOTES_PAGE_SIZE, roleOf } from "@manifesto/shared";
import type { StorageDriver } from "#/storage/types.ts";
import type { NoteEvents } from "./noteEvents.ts";

/**
 * Empties an account whose keys are gone: everything sealed under them can
 * never be read again, so it is removed rather than left as ciphertext nobody
 * opens. The notes it owns go from everyone who held them, the notes shared
 * with it and the invitations waiting for it are given up (their owners keep
 * them, and decide whether to share again with the new keys), and its
 * preferences go. The account itself stays: its sign-in, its email address
 * and its place in teams.
 */
export async function emptyAccount(
  deps: { storage: StorageDriver; noteEvents: NoteEvents },
  userId: string,
): Promise<void> {
  const { storage, noteEvents } = deps;
  const held: { id: string; own: boolean }[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.notes.listByUser(userId, {
      limit: MAX_NOTES_PAGE_SIZE,
      ...(cursor !== undefined && { cursor }),
    });
    for (const note of page.notes) {
      held.push({ id: note.id, own: roleOf(note) === "owner" });
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);

  for (const { id, own } of held) {
    if (own) {
      // Read before the delete, which takes the shares with it by cascade.
      const shares = (await storage.shares.audience(id))?.shares ?? [];
      if (await storage.notes.delete(id, userId)) {
        noteEvents.deleted(id, userId, shares);
      }
      continue;
    }
    const removed = await storage.shares.delete(id, userId);
    if (!removed) continue;
    noteEvents.ended([removed]);
    await noteEvents.changed(id);
  }
  // Every share left, whatever state it or its note is in: an invitation,
  // and a note its owner has in the trash, which no listing shows and which
  // would come back from there under a key this account can no longer open.
  for (const share of await storage.shares.listByRecipient(userId)) {
    const removed = await storage.shares.delete(share.noteId, userId);
    if (!removed) continue;
    noteEvents.ended([removed]);
    await noteEvents.changed(share.noteId);
  }
  await storage.prefs.clear(userId);
}
