import type { NoteShare, StorageDriver } from "../storage/types.js";
import type { Broadcaster } from "../ws/broadcaster.js";
import type { AccessChanges } from "./accessChanges.js";

/**
 * Who hears about a change to a shared note, and what each of them hears.
 *
 * The broadcaster sends to one user at a time, and a shared note looks
 * different to each person holding it: their own color, pin and tags, their
 * own role. So a change is sent as each participant's own copy, read back for
 * them, rather than as the one note the writer got back.
 */
export interface NoteEvents {
  /**
   * A note changed. Everyone who can see it gets their copy, and everyone who
   * has accepted it but can no longer see it (the owner trashed it) is told it
   * is gone. `trashChanged` also brings pending invitations up to date, since
   * a trashed note offers nothing to accept.
   */
  changed(noteId: string, options?: { trashChanged?: boolean }): Promise<void>;
  /**
   * These shares are over: the note was deleted, the share removed, or the
   * owner's account went. Accepted ones lose the note, pending ones the
   * invitation, and their sockets are closed on it.
   */
  ended(shares: NoteShare[]): void;
}

export function createNoteEvents(deps: {
  storage: StorageDriver;
  broadcaster: Broadcaster;
  accessChanges: AccessChanges;
}): NoteEvents {
  const { storage, broadcaster, accessChanges } = deps;

  async function sendCopy(noteId: string, userId: string): Promise<void> {
    const note = await storage.notes.getById(noteId, userId);
    broadcaster.emit(
      userId,
      note
        ? { type: "note:updated", note }
        : { type: "note:deleted", id: noteId },
    );
  }

  return {
    async changed(noteId, options = {}) {
      const audience = await storage.shares.audience(noteId);
      if (!audience) return;
      const accepted = audience.shares.filter((s) => s.acceptedAt !== null);
      await Promise.all(
        [audience.ownerId, ...accepted.map((s) => s.userId)].map((userId) =>
          sendCopy(noteId, userId),
        ),
      );
      if (!options.trashChanged) return;
      accessChanges.announce({
        noteId,
        userIds: accepted.map((s) => s.userId),
        change: audience.trashed ? "lost-all" : "gained",
      });
      for (const share of audience.shares) {
        if (share.acceptedAt !== null) continue;
        if (audience.trashed) {
          broadcaster.emit(share.userId, {
            type: "invitation:removed",
            noteId,
          });
          continue;
        }
        const invitation = await storage.shares.getInvitation(
          noteId,
          share.userId,
        );
        if (invitation) {
          broadcaster.emit(share.userId, {
            type: "invitation:created",
            invitation,
          });
        }
      }
    },

    ended(shares) {
      for (const share of shares) {
        broadcaster.emit(
          share.userId,
          share.acceptedAt === null
            ? { type: "invitation:removed", noteId: share.noteId }
            : { type: "note:deleted", id: share.noteId },
        );
      }
      const byNote = new Map<string, string[]>();
      for (const share of shares) {
        if (share.acceptedAt === null) continue;
        byNote.set(share.noteId, [
          ...(byNote.get(share.noteId) ?? []),
          share.userId,
        ]);
      }
      for (const [noteId, userIds] of byNote) {
        accessChanges.announce({ noteId, userIds, change: "lost-all" });
      }
    },
  };
}
