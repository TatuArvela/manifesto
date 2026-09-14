import { zValidator } from "@hono/zod-validator";
import type {
  InvitationsResponse,
  NoteResponse,
  ShareRole,
} from "@manifesto/shared";
import type { Hono } from "hono";
import { nowIso } from "../lib/time.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { AccessChanges } from "../sharing/accessChanges.js";
import type { NoteEvents } from "../sharing/noteEvents.js";
import type { StorageDriver } from "../storage/types.js";
import { shareCreateSchema, shareUpdateSchema } from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";
import type { Broadcaster } from "../ws/broadcaster.js";

export interface ShareRoutesDeps {
  storage: StorageDriver;
  broadcaster: Broadcaster;
  noteEvents: NoteEvents;
  accessChanges: AccessChanges;
}

type AuthedApp = Hono<{ Variables: { auth: AuthContext } }>;

/**
 * `/api/notes/:id/shares`: who a note is shared with, managed by its owner.
 *
 * Registered on the notes router, behind its authentication and rate limit.
 * Only the owner invites, changes a role or removes someone; anyone holding
 * an invitation or a share may remove themselves, which is how a recipient
 * leaves a note.
 */
export function registerShareRoutes(notes: AuthedApp, deps: ShareRoutesDeps) {
  const { storage, broadcaster, noteEvents, accessChanges } = deps;

  async function requireOwner(noteId: string, userId: string): Promise<void> {
    const access = await storage.notes.access(noteId, userId);
    if (!access) throw new HttpError(404, "Note not found");
    if (access.role !== "owner") {
      throw new HttpError(403, "Only the owner can change who has this note");
    }
  }

  async function ownerView(noteId: string, userId: string) {
    const note = await storage.notes.getById(noteId, userId);
    if (!note) throw new HttpError(404, "Note not found");
    const body: NoteResponse = { note };
    return body;
  }

  notes.post(
    "/:id/shares",
    zValidator("json", shareCreateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const noteId = c.req.param("id") as string;
      const { userId: recipientId, role } = c.req.valid("json");
      await requireOwner(noteId, userId);
      const note = await storage.notes.getById(noteId, userId);
      if (!note) throw new HttpError(404, "Note not found");
      if (note.trashed) {
        throw new HttpError(409, "A note in the trash cannot be shared");
      }
      // An automatic note is rewritten by a plugin in its owner's browser, so
      // nobody else could edit it and what they saw would be overwritten.
      if (note.readonly) {
        throw new HttpError(422, "Automatic notes cannot be shared");
      }
      if (recipientId === userId) {
        throw new HttpError(
          422,
          "userId: You cannot share a note with yourself",
        );
      }
      if (!(await storage.users.findById(recipientId))) {
        throw new HttpError(404, "User not found");
      }
      const created = await storage.shares.create({
        noteId,
        userId: recipientId,
        role,
        createdAt: nowIso(),
      });
      if (created === "exists") {
        throw new HttpError(409, "The note is already shared with this user");
      }
      const invitation = await storage.shares.getInvitation(
        noteId,
        recipientId,
      );
      if (invitation) {
        broadcaster.emit(recipientId, {
          type: "invitation:created",
          invitation,
        });
      }
      await noteEvents.changed(noteId);
      return c.json(await ownerView(noteId, userId), 201);
    },
  );

  notes.put(
    "/:id/shares/:userId",
    zValidator("json", shareUpdateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const noteId = c.req.param("id") as string;
      const recipientId = c.req.param("userId") as string;
      const { role } = c.req.valid("json");
      await requireOwner(noteId, userId);
      const before = (await storage.shares.audience(noteId))?.shares.find(
        (s) => s.userId === recipientId,
      );
      if (!before) throw new HttpError(404, "Share not found");
      if (before.role !== role) {
        if (!(await storage.shares.setRole(noteId, recipientId, role))) {
          throw new HttpError(404, "Share not found");
        }
        await announceRole(noteId, recipientId, before.acceptedAt, role);
        await noteEvents.changed(noteId);
      }
      return c.json(await ownerView(noteId, userId));
    },
  );

  async function announceRole(
    noteId: string,
    recipientId: string,
    acceptedAt: string | null,
    role: ShareRole,
  ): Promise<void> {
    if (acceptedAt === null) {
      const invitation = await storage.shares.getInvitation(
        noteId,
        recipientId,
      );
      if (invitation) {
        broadcaster.emit(recipientId, {
          type: "invitation:created",
          invitation,
        });
      }
      return;
    }
    // Still a reader, no longer a writer: the live document is what they
    // have to be taken out of.
    if (role === "view") {
      accessChanges.announce({
        noteId,
        userIds: [recipientId],
        change: "lost-edit",
      });
    }
  }

  notes.delete("/:id/shares/:userId", async (c) => {
    const { userId } = c.get("auth");
    const noteId = c.req.param("id") as string;
    const recipientId = c.req.param("userId") as string;
    if (recipientId !== userId) await requireOwner(noteId, userId);
    const removed = await storage.shares.delete(noteId, recipientId);
    if (!removed) throw new HttpError(404, "Share not found");
    noteEvents.ended([removed]);
    await noteEvents.changed(noteId);
    return c.body(null, 204);
  });
}

interface InvitationRoutesDeps {
  storage: StorageDriver;
  broadcaster: Broadcaster;
  noteEvents: NoteEvents;
  accessChanges: AccessChanges;
}

/** `/api/invitations`: notes offered to the signed-in user. */
export function registerInvitationRoutes(
  invitations: AuthedApp,
  deps: InvitationRoutesDeps,
) {
  const { storage, broadcaster, noteEvents, accessChanges } = deps;

  invitations.get("/", async (c) => {
    const { userId } = c.get("auth");
    const body: InvitationsResponse = {
      invitations: await storage.shares.listInvitations(userId),
    };
    return c.json(body);
  });

  invitations.post("/:noteId/accept", async (c) => {
    const { userId } = c.get("auth");
    const noteId = c.req.param("noteId") as string;
    if (!(await storage.shares.accept(noteId, userId, nowIso()))) {
      throw new HttpError(404, "Invitation not found");
    }
    const note = await storage.notes.getById(noteId, userId);
    if (!note) throw new HttpError(404, "Invitation not found");
    // The user's other tabs still show the invitation.
    broadcaster.emit(userId, { type: "invitation:removed", noteId });
    await noteEvents.changed(noteId);
    // Whoever is looking at the note right now shows up for them at once.
    accessChanges.announce({ noteId, userIds: [userId], change: "gained" });
    const body: NoteResponse = { note };
    return c.json(body);
  });

  invitations.post("/:noteId/decline", async (c) => {
    const { userId } = c.get("auth");
    const noteId = c.req.param("noteId") as string;
    // Only an invitation: leaving a note already accepted is a DELETE on its
    // share, and saying "decline" to one should not quietly do that.
    if (!(await storage.shares.getInvitation(noteId, userId))) {
      throw new HttpError(404, "Invitation not found");
    }
    const removed = await storage.shares.delete(noteId, userId);
    if (!removed) throw new HttpError(404, "Invitation not found");
    noteEvents.ended([removed]);
    await noteEvents.changed(noteId);
    return c.body(null, 204);
  });
}
