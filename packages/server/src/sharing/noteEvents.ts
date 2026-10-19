import type { SealedNote, WebSocketEvent } from "@manifesto/shared";
import type {
  NoteAudience,
  NoteShare,
  StorageDriver,
} from "#/storage/types.ts";
import type { Broadcaster } from "#/ws/broadcaster.ts";
import type { AccessChanges } from "./accessChanges.ts";

/**
 * Who learns about a note or an invitation to one, and what each of them gets.
 * Each `note:*` and `invitation:*` event goes out from here. Thus, the sockets
 * and the webhooks that listen to the broadcaster get one version of it
 * (`biome-plugins/noteEvents.grit` refuses one built in a different place).
 *
 * The broadcaster sends to one user at a time. A shared note looks different to
 * each person who has it: their own color, pin and tags, their own role. Thus,
 * a change goes out as the own copy of each participant, read back for them. It
 * does not go out as the one note that the writer got back.
 */
export interface NoteEvents {
  /** A new note. Only its owner has it now. */
  created(note: SealedNote, ownerId: string): void;
  /**
   * A note changed. Each person who can see it gets their copy. Each person who
   * accepted it, but cannot see it now (the owner put it in the trash), learns
   * that it is gone. `trashChanged` also updates pending invitations, because a
   * trashed note offers nothing to accept.
   */
  changed(noteId: string, options?: { trashChanged?: boolean }): Promise<void>;
  /**
   * These shares ended: the note was deleted, the share was removed, or the
   * account of the owner went. Accepted shares lose the note, pending shares
   * lose the invitation, and their sockets close on it.
   */
  ended(shares: NoteShare[]): void;
  /**
   * The owner deleted the note, or its trash expired. The owner loses it, and
   * `shares` (read before the delete removed them) end.
   */
  deleted(noteId: string, ownerId: string, shares: NoteShare[]): void;
  /** A pending share. Its recipient sees the invitation as it is now. */
  invited(noteId: string, userId: string): Promise<void>;
  /** The user answered an invitation. Their other tabs drop it. */
  answered(noteId: string, userId: string): void;
  /**
   * A comment of the note was written, changed or removed. All persons who can
   * see the note get the same event, because a comment has no personal fields.
   * It takes the audience that the caller read to name the author of the
   * comment, and does not read it a second time.
   */
  commented(audience: NoteAudience | null, event: CommentEvent): void;
}

/** The events that a comment makes on the sockets. */
export type CommentEvent = Extract<
  WebSocketEvent,
  { type: `comment:${string}` }
>;

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

  async function invited(noteId: string, userId: string): Promise<void> {
    const invitation = await storage.shares.getInvitation(noteId, userId);
    if (invitation) {
      broadcaster.emit(userId, { type: "invitation:created", invitation });
    }
  }

  function ended(shares: NoteShare[]): void {
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
  }

  return {
    created(note, ownerId) {
      broadcaster.emit(ownerId, { type: "note:created", note });
    },

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
        await invited(noteId, share.userId);
      }
    },

    ended,

    deleted(noteId, ownerId, shares) {
      broadcaster.emit(ownerId, { type: "note:deleted", id: noteId });
      ended(shares);
    },

    invited,

    answered(noteId, userId) {
      broadcaster.emit(userId, { type: "invitation:removed", noteId });
    },

    commented(audience, event) {
      if (!audience) return;
      // In the trash of the owner, the note is hidden from all other persons.
      // So is what is said next to it.
      const others = audience.trashed
        ? []
        : audience.shares.filter((s) => s.acceptedAt !== null);
      for (const userId of [audience.ownerId, ...others.map((s) => s.userId)]) {
        broadcaster.emit(userId, event);
      }
    },
  };
}
