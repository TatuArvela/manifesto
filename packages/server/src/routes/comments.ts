import {
  MAX_COMMENTS_PER_NOTE,
  type NoteComment,
  type NoteCommentResponse,
  type NoteCommentsResponse,
  type ShareUser,
} from "@manifesto/shared";
import type { Context, Hono } from "hono";
import { nowIso } from "#/lib/time.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { NoteEvents } from "#/sharing/noteEvents.ts";
import type {
  NoteAudience,
  StorageDriver,
  StoredComment,
} from "#/storage/types.ts";
import {
  commentBody,
  commentOut,
  type NoteRing,
  noteRing,
  tokenKeys,
} from "./noteCodec.ts";

type AuthedApp = Hono<{ Variables: { auth: AuthContext } }>;
type Ctx = Context<{ Variables: { auth: AuthContext } }>;

/**
 * `/api/v1/notes/:id/comments`: what the people on a note say next to it. A
 * comment is never part of the text, the versions or the `updatedAt` of the
 * note.
 *
 * Registered on the notes router. All persons who can see the note read the
 * comments, and can write one, also a viewer. A comment lets a person who
 * cannot change the note say something about it. Only its author can edit a
 * comment. Its author or the owner of the note can delete it.
 *
 * A comment stays after its author leaves the note. When they lose their place
 * (the share removed, the note left, the account deleted), the comment stays,
 * and goes out with no author. Thus, the thread still reads correctly, and
 * nobody is named on a note that they are not on now. This code decides that on
 * each read, from the current holders of the note. Thus, a new share with them
 * brings the name back.
 */
export function registerCommentRoutes(
  notes: AuthedApp,
  deps: { storage: StorageDriver; noteEvents: NoteEvents },
) {
  const { storage, noteEvents } = deps;

  /** The role of the caller, or a 404 that does not tell if the note exists. */
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

  /** The people that the comments of a note can name: the people on it now. */
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

  /** The authors that these comments can name: the people on the note. */
  async function authorsOf(
    audience: NoteAudience | null,
    stored: StoredComment[],
  ): Promise<Map<string, ShareUser>> {
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
    return authors;
  }

  /**
   * A stored comment as it goes out. Its author is named only while they are on
   * the note.
   */
  function present(
    comment: StoredComment,
    authors: Map<string, ShareUser>,
  ): NoteComment {
    return {
      id: comment.id,
      noteId: comment.noteId,
      author:
        comment.authorId === null
          ? null
          : (authors.get(comment.authorId) ?? null),
      body: comment.body,
      keyVersion: comment.keyVersion,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
    };
  }

  async function presentOne(
    audience: NoteAudience | null,
    stored: StoredComment,
  ): Promise<NoteComment> {
    return present(stored, await authorsOf(audience, [stored]));
  }

  /**
   * The keys of the note for a request from a token that carries them, which
   * reads and writes the words of a comment. Null for the own session of the
   * app, which sends and gets them sealed.
   */
  async function ringFor(c: Ctx, noteId: string): Promise<NoteRing | null> {
    const keys = tokenKeys(c);
    return keys ? noteRing(keys, storage, noteId) : null;
  }

  /**
   * A comment as this request gets it: sealed for the app, readable for a
   * token.
   */
  async function answered(
    ring: NoteRing | null,
    comment: NoteComment,
  ): Promise<NoteComment> {
    if (!ring) return comment;
    return { ...comment, body: (await commentOut(ring, comment)) ?? "" };
  }

  notes.get("/:id/comments", async (c) => {
    const { userId } = c.get("auth");
    const noteId = c.req.param("id") as string;
    await requireAccess(noteId, userId);
    const ring = await ringFor(c, noteId);
    const stored = await storage.comments.listByNote(noteId);
    const authors = await authorsOf(
      await storage.shares.audience(noteId),
      stored,
    );
    const comments: NoteComment[] = [];
    for (const one of stored) {
      const comment = present(one, authors);
      if (!ring) {
        comments.push(comment);
        continue;
      }
      // The code skips a comment that does not open, as the app does.
      const text = await commentOut(ring, comment);
      if (text !== null) comments.push({ ...comment, body: text });
    }
    const body: NoteCommentsResponse = { comments };
    return c.json(body);
  });

  notes.post("/:id/comments", async (c) => {
    const { userId } = c.get("auth");
    const noteId = c.req.param("id") as string;
    await requireAccess(noteId, userId);
    const ring = await ringFor(c, noteId);
    const sent = await commentBody(c, ring);
    // The writer that sealed it selected the id, to which the sealed text is
    // bound.
    if (await storage.comments.get(sent.id)) {
      throw new HttpError(409, "A comment already has this id");
    }
    const stored: StoredComment = {
      id: sent.id,
      noteId,
      authorId: userId,
      body: sent.body,
      keyVersion: sent.keyVersion,
      createdAt: nowIso(),
      editedAt: null,
    };
    if (!(await storage.comments.create(stored, MAX_COMMENTS_PER_NOTE))) {
      throw new HttpError(409, "This note has as many comments as it holds");
    }
    const audience = await storage.shares.audience(noteId);
    const comment = await presentOne(audience, stored);
    noteEvents.commented(audience, { type: "comment:created", comment });
    const body: NoteCommentResponse = {
      comment: await answered(ring, comment),
    };
    return c.json(body, 201);
  });

  notes.put("/:id/comments/:commentId", async (c) => {
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
    const ring = await ringFor(c, noteId);
    const audience = await storage.shares.audience(noteId);
    // The same words again from a token are not an edit, and here the server
    // can tell. Nothing is sealed, stamped or announced.
    if (ring) {
      const text = (await c.req.raw
        .clone()
        .json()
        .catch(() => null)) as {
        body?: unknown;
      } | null;
      const was = await commentOut(ring, existing);
      if (
        was !== null &&
        typeof text?.body === "string" &&
        text.body.trim() === was
      ) {
        const body: NoteCommentResponse = {
          comment: await answered(ring, await presentOne(audience, existing)),
        };
        return c.json(body);
      }
    }
    const { body: next, keyVersion } = await commentBody(c, ring, existing.id);
    // The same sealed text again is not an edit. Nothing is stamped, and nobody
    // gets a message. A client that seals the same words again sends a
    // different ciphertext. Thus, the client must not send a comment that did
    // not change.
    if (next === existing.body) {
      const body: NoteCommentResponse = {
        comment: await presentOne(audience, existing),
      };
      return c.json(body);
    }
    const editedAt = nowIso();
    await storage.comments.setBody(existing.id, next, keyVersion, editedAt);
    const comment = await presentOne(audience, {
      ...existing,
      body: next,
      keyVersion,
      editedAt,
    });
    noteEvents.commented(audience, { type: "comment:updated", comment });
    const body: NoteCommentResponse = {
      comment: await answered(ring, comment),
    };
    return c.json(body);
  });

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
