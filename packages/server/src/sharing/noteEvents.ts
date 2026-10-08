import type { Note, WebSocketEvent } from "@manifesto/shared";
import type {
  NoteAudience,
  NoteShare,
  StorageDriver,
} from "../storage/types.js";
import type { Broadcaster } from "../ws/broadcaster.js";
import type { AccessChanges } from "./accessChanges.js";

/**
 * Who hears about a note or an invitation to one, and what each of them
 * hears. Every `note:*` and `invitation:*` event goes out from here, so the
 * sockets and the webhooks listening to the broadcaster hear one account of
 * it (`biome-plugins/noteEvents.grit` refuses one built anywhere else).
 *
 * The broadcaster sends to one user at a time, and a shared note looks
 * different to each person holding it: their own color, pin and tags, their
 * own role. So a change is sent as each participant's own copy, read back for
 * them, rather than as the one note the writer got back.
 */
export interface NoteEvents {
  /** A new note. Only its owner holds it yet. */
  created(note: Note, ownerId: string): void;
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
  /**
   * The owner deleted the note, or its trash expired: the owner loses it,
   * and `shares`, read before the delete took them with it, are over.
   */
  deleted(noteId: string, ownerId: string, shares: NoteShare[]): void;
  /** A pending share: its recipient sees the invitation as it now reads. */
  invited(noteId: string, userId: string): Promise<void>;
  /** The user answered an invitation: their other tabs drop it. */
  answered(noteId: string, userId: string): void;
  /**
   * A comment beside the note was written, changed or removed. Everyone who
   * can see the note hears the same event: a comment has no personal fields.
   * Takes the audience the caller read to name the comment's author, rather
   * than reading it a second time.
   */
  commented(audience: NoteAudience | null, event: CommentEvent): void;
}

/** The events a comment makes on the sockets. */
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
      // In the owner's trash the note is hidden from everyone else, and so
      // is what is said beside it.
      const others = audience.trashed
        ? []
        : audience.shares.filter((s) => s.acceptedAt !== null);
      for (const userId of [audience.ownerId, ...others.map((s) => s.userId)]) {
        broadcaster.emit(userId, event);
      }
    },
  };
}
