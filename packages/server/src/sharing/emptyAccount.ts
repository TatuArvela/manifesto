import { MAX_NOTES_PAGE_SIZE, roleOf } from "@manifesto/shared";
import type { StorageDriver } from "#/storage/types.ts";
import type { NoteEvents } from "./noteEvents.ts";

/**
 * Empties an account whose keys are gone. Nobody can ever read the data sealed
 * under them again. Thus, the code removes it, and does not leave ciphertext
 * that nobody opens. The notes that it owns go from all persons who had them.
 * The code gives up the notes shared with it and the invitations that wait for
 * it (their owners keep them, and decide whether to share again with the new
 * keys). Its preferences go. The account itself stays: its sign-in, its email
 * address and its place in teams.
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
      // Read before the delete, because the cascade deletes the shares.
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
  // Each share that is left, whatever its state or the state of its note: an
  // invitation, and a note that its owner has in the trash. No listing shows
  // that note, and it would come back from there under a key that this account
  // cannot open now.
  for (const share of await storage.shares.listByRecipient(userId)) {
    const removed = await storage.shares.delete(share.noteId, userId);
    if (!removed) continue;
    noteEvents.ended([removed]);
    await noteEvents.changed(share.noteId);
  }
  await storage.prefs.clear(userId);
}
