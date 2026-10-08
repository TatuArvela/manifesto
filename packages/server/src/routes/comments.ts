import { zValidator } from "@hono/zod-validator";
import {
  MAX_COMMENTS_PER_NOTE,
  type NoteComment,
  type NoteCommentResponse,
  type NoteCommentsResponse,
  type ShareUser,
} from "@manifesto/shared";
import type { Hono } from "hono";
import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { NoteEvents } from "../sharing/noteEvents.js";
import type {
  NoteAudience,
  StorageDriver,
  StoredComment,
} from "../storage/types.js";
import { noteCommentSchema } from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

type AuthedApp = Hono<{ Variables: { auth: AuthContext } }>;

/**
 * `/api/notes/:id/comments`: what the people on a note say beside it. A
 * comment is never part of the note's text, its versions or its `updatedAt`.
 *
 * Registered on the notes router. Everyone who can see the note reads the
 * comments and may write one, a viewer included, since a comment is how
 * someone who cannot change the note says something about it. A comment is
 * edited by its author alone and deleted by its author or the note's owner.
 *
 * A comment outlives its author's place on the note. Once they lose it (the
 * share removed, the note left, the account deleted) the comment stays and is
 * given out with no author, so the thread still reads and nobody is named on
 * a note they are no longer on. That is decided here, on every read, from who
 * holds the note now, so sharing with them again brings the name back.
 */
export function registerCommentRoutes(
  notes: AuthedApp,
  deps: { storage: StorageDriver; noteEvents: NoteEvents },
) {
  const { storage, noteEvents } = deps;

  /** The caller's role, or a 404 that does not say the note exists. */
  async function requireAccess(noteId: string, userId: string) {
    const access = await storage.notes.access(noteId, userId);
    if (!access) throw new HttpError(404, "Note not found");
    return access;
  }

  /** The comment, if it is on this note. */
  async function requireComment(
    noteId: string,
    commentId: string,
  ): Promise<StoredComment> {
    const comment = await storage.comments.get(commentId);
    if (!comment || comment.noteId !== noteId) {
      throw new HttpError(404, "Comment not found");
    }
    return comment;
  }

  /** The people a note's comments may name: those on it now. */
  function peopleOn(audience: NoteAudience | null): Set<string> {
    return new Set(
      audience
        ? [
            audience.ownerId,
            ...audience.shares
              .filter((share) => share.acceptedAt !== null)
              .map((share) => share.userId),
          ]
        : [],
    );
  }

  /** Stored comments as they are given out, authors named only while they
   * are on the note. */
  async function present(
    audience: NoteAudience | null,
    stored: StoredComment[],
  ): Promise<NoteComment[]> {
    const onNote = peopleOn(audience);
    const authorIds = new Set<string>();
    for (const { authorId } of stored) {
      if (authorId !== null && onNote.has(authorId)) authorIds.add(authorId);
    }
    const authors = new Map<string, ShareUser>();
    await Promise.all(
      [...authorIds].map(async (id) => {
        const user = await storage.users.findById(id);
        if (!user) return;
        authors.set(id, {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarColor: user.avatarColor,
        });
      }),
    );
    return stored.map((comment) => ({
      id: comment.id,
      noteId: comment.noteId,
      author:
        comment.authorId === null
          ? null
          : (authors.get(comment.authorId) ?? null),
      body: comment.body,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
    }));
  }

  async function presentOne(
    audience: NoteAudience | null,
    stored: StoredComment,
  ): Promise<NoteComment> {
    const [comment] = await present(audience, [stored]);
    if (!comment) throw new HttpError(404, "Comment not found");
    return comment;
  }

  notes.get("/:id/comments", async (c) => {
    const { userId } = c.get("auth");
    const noteId = c.req.param("id") as string;
    await requireAccess(noteId, userId);
    const body: NoteCommentsResponse = {
      comments: await present(
        await storage.shares.audience(noteId),
        await storage.comments.listByNote(noteId),
      ),
    };
    return c.json(body);
  });

  notes.post(
    "/:id/comments",
    zValidator("json", noteCommentSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const noteId = c.req.param("id") as string;
      await requireAccess(noteId, userId);
      const stored: StoredComment = {
        id: newId(),
        noteId,
        authorId: userId,
        body: c.req.valid("json").body,
        createdAt: nowIso(),
        editedAt: null,
      };
      if (!(await storage.comments.create(stored, MAX_COMMENTS_PER_NOTE))) {
        throw new HttpError(409, "This note has as many comments as it holds");
      }
      const audience = await storage.shares.audience(noteId);
      const comment = await presentOne(audience, stored);
      noteEvents.commented(audience, { type: "comment:created", comment });
      const body: NoteCommentResponse = { comment };
      return c.json(body, 201);
    },
  );

  notes.put(
    "/:id/comments/:commentId",
    zValidator("json", noteCommentSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const noteId = c.req.param("id") as string;
      await requireAccess(noteId, userId);
      const existing = await requireComment(
        noteId,
        c.req.param("commentId") as string,
      );
      if (existing.authorId !== userId) {
        throw new HttpError(403, "Only its author can change a comment");
      }
      const next = c.req.valid("json").body;
      const editedAt = nowIso();
      if (next !== existing.body) {
        await storage.comments.setBody(existing.id, next, editedAt);
      }
      const audience = await storage.shares.audience(noteId);
      const comment = await presentOne(
        audience,
        next === existing.body
          ? existing
          : { ...existing, body: next, editedAt },
      );
      if (next !== existing.body) {
        noteEvents.commented(audience, {
          type: "comment:updated",
          comment,
        });
      }
      const body: NoteCommentResponse = { comment };
      return c.json(body);
    },
  );

  notes.delete("/:id/comments/:commentId", async (c) => {
    const { userId } = c.get("auth");
    const noteId = c.req.param("id") as string;
    const access = await requireAccess(noteId, userId);
    const existing = await requireComment(
      noteId,
      c.req.param("commentId") as string,
    );
    if (existing.authorId !== userId && access.role !== "owner") {
      throw new HttpError(
        403,
        "Only its author or the note's owner can delete a comment",
      );
    }
    await storage.comments.delete(existing.id);
    noteEvents.commented(await storage.shares.audience(noteId), {
      type: "comment:deleted",
      noteId,
      id: existing.id,
    });
    return c.body(null, 204);
  });
}
