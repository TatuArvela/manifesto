import { zValidator } from "@hono/zod-validator";
import {
  type InvitationsResponse,
  type NoteResponse,
  roleOf,
  type SealedNote,
  type ShareRole,
} from "@manifesto/shared";
import { Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import { createExpiringCounter } from "#/lib/expiringCounter.ts";
import { nowIso } from "#/lib/time.ts";
import type { Mailer } from "#/mail/mailer.ts";
import { mailLocale, shareInvitationMail } from "#/mail/templates.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { AccessChanges } from "#/sharing/accessChanges.ts";
import type { NoteEvents } from "#/sharing/noteEvents.ts";
import type { StorageDriver } from "#/storage/types.ts";
import {
  heldKeySchema,
  offeredKeySchema,
  shareCreateSchema,
  shareUpdateSchema,
} from "#/validation/sharingSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";

export interface ShareRoutesDeps {
  /** Sends the invitation by mail too, when the server has mail and the
   * recipient an address. */
  mail?: { mailer: Mailer; appUrl: string } | null;
  storage: StorageDriver;
  noteEvents: NoteEvents;
  accessChanges: AccessChanges;
}

type AuthedApp = Hono<{ Variables: { auth: AuthContext } }>;

/**
 * Invitation mails one account may send another in an hour. Sharing, removing
 * and sharing again mails each time, and the mail carries the sender's own
 * words (the note's title) from this server's address, so without a bound an
 * account is a way to flood or phish anyone it can name. The invitation
 * itself is always made; past this only its mail is left out.
 */
export const INVITATION_MAILS_PER_HOUR = 5;

/**
 * `/api/notes/:id/shares`: who a note is shared with, managed by its owner.
 *
 * Registered on the notes router, behind its authentication and rate limit.
 * Only the owner invites, changes a role or removes someone; anyone holding
 * an invitation or a share may remove themselves, which is how a recipient
 * leaves a note.
 */
export function registerShareRoutes(notes: AuthedApp, deps: ShareRoutesDeps) {
  const { storage, noteEvents, accessChanges } = deps;
  const invitationMails = createExpiringCounter({
    windowMs: 60 * 60 * 1000,
    maxEntries: 50_000,
  });

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
    const body: NoteResponse<SealedNote> = { note };
    return body;
  }

  notes.post(
    "/:id/shares",
    zValidator("json", shareCreateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const noteId = c.req.param("id") as string;
      const { userId: recipientId, role, key } = c.req.valid("json");
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
      const recipient = await storage.users.findById(recipientId);
      if (!recipient) throw new HttpError(404, "User not found");
      // Signed by whoever sends it, or the recipient's client would refuse
      // it anyway; and for the key the note is under now.
      if (
        key &&
        (key.signer !== userId || key.keyVersion !== note.keyVersion)
      ) {
        throw new HttpError(422, "key: Not a key of this note from you");
      }
      const created = await storage.shares.create({
        noteId,
        userId: recipientId,
        role,
        createdAt: nowIso(),
        offeredKey: key ?? null,
      });
      if (created === "exists") {
        // Someone who has the note through a team can be given it directly,
        // which takes it out of the team's hands: removing the team share no
        // longer removes them. A direct share already there is a conflict.
        const existing = (await storage.shares.audience(noteId))?.shares.find(
          (share) => share.userId === recipientId,
        );
        if (!existing?.viaTeam) {
          throw new HttpError(409, "The note is already shared with this user");
        }
        await storage.shares.setViaTeam(noteId, recipientId, null);
        if (key) await storage.shares.offerKey(noteId, recipientId, key);
        if (existing.role !== role) {
          await storage.shares.setRole(noteId, recipientId, role);
          await announceRole(noteId, recipientId, existing.acceptedAt, role);
        }
        audit(storage, c, {
          action: "share.created",
          actorId: userId,
          targetId: recipientId,
          noteId,
          detail: { role, from: "team" },
        });
        await noteEvents.changed(noteId);
        return c.json(await ownerView(noteId, userId), 201);
      }
      await noteEvents.invited(noteId, recipientId);
      audit(storage, c, {
        action: "share.created",
        actorId: userId,
        targetId: recipientId,
        noteId,
        detail: { role },
      });
      if (
        deps.mail &&
        recipient.email &&
        invitationMails.hit(`${userId}\u0000${recipientId}`).count <=
          INVITATION_MAILS_PER_HOUR
      ) {
        const owner = await storage.users.findById(userId);
        const message = shareInvitationMail(
          // The recipient's language, which their client reported; the
          // sharer's would be the wrong one whenever the two differ.
          mailLocale(recipient.locale?.split("-")[0]),
          {
            owner: owner?.displayName || owner?.username || "",
            link: deps.mail.appUrl,
          },
        );
        // Not awaited: the share is made whether or not the mail goes.
        void deps.mail.mailer.send({ to: recipient.email, ...message });
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
        audit(storage, c, {
          action: "share.role_changed",
          actorId: userId,
          targetId: recipientId,
          noteId,
          detail: { from: before.role, to: role },
        });
        await noteEvents.changed(noteId);
      }
      return c.json(await ownerView(noteId, userId));
    },
  );

  /**
   * Hands someone on the note its key, wrapped to their public key and
   * signed by the caller. Anyone who holds the note may: a share to a team
   * reaches members the owner's client never wrapped for, and whoever of the
   * note's holders is online first does it. The recipient's client decides
   * whether to trust it, by the signature and by whether it opens the note.
   * Only someone still waiting is handed one: a key they hold, or one they
   * were offered and have not taken yet, is replaced by the owner alone, or
   * any holder could put a key of their own making in its place.
   */
  notes.put(
    "/:id/shares/:userId/key",
    zValidator("json", offeredKeySchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const noteId = c.req.param("id") as string;
      const recipientId = c.req.param("userId") as string;
      const key = c.req.valid("json");
      const note = await storage.notes.getById(noteId, userId);
      // Only someone who holds the key can wrap it: the owner, or a
      // recipient whose own copy is the one the note is under.
      if (!note || note.key === "") throw new HttpError(404, "Note not found");
      if (key.signer !== userId || key.keyVersion !== note.keyVersion) {
        throw new HttpError(422, "Not a key of this note from you");
      }
      const ownerId = note.sharing?.owner.id;
      if (roleOf(note) !== "owner" && ownerId !== undefined) {
        // As the owner sees the note: an invitation is not among the
        // members a recipient is shown.
        const whole = await storage.notes.getById(noteId, ownerId);
        const member = whole?.sharing?.members.find(
          (m) => m.id === recipientId,
        );
        if (!member) throw new HttpError(404, "Share not found");
        if (!member.waitingForKey) {
          throw new HttpError(409, "They are not waiting for this note's key");
        }
      }
      if (!(await storage.shares.offerKey(noteId, recipientId, key))) {
        throw new HttpError(404, "Share not found");
      }
      const share = (await storage.shares.audience(noteId))?.shares.find(
        (s) => s.userId === recipientId,
      );
      if (share?.acceptedAt === null) {
        await noteEvents.invited(noteId, recipientId);
      }
      await noteEvents.changed(noteId);
      return c.body(null, 204);
    },
  );

  /**
   * The note key as the caller now keeps it, after the note's key was
   * replaced: opened from what they were offered, wrapped under their own
   * notes key. Their own to write, like the rest of their share.
   */
  notes.put(
    "/:id/held-key",
    zValidator("json", heldKeySchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const noteId = c.req.param("id") as string;
      const held = c.req.valid("json");
      const note = await storage.notes.getById(noteId, userId);
      if (!note) throw new HttpError(404, "Note not found");
      if (roleOf(note) === "owner") {
        throw new HttpError(409, "The owner's key is the note's own");
      }
      if (held.keyVersion !== note.keyVersion) {
        throw new HttpError(409, "The note is under another key now");
      }
      if (!(await storage.shares.holdKey(noteId, userId, held))) {
        throw new HttpError(404, "Note not found");
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
      await noteEvents.invited(noteId, recipientId);
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
    audit(storage, c, {
      action: "share.removed",
      actorId: userId,
      targetId: recipientId,
      noteId,
      ...(recipientId === userId && { detail: { left: "yes" } }),
    });
    noteEvents.ended([removed]);
    await noteEvents.changed(noteId);
    return c.body(null, 204);
  });
}

interface InvitationRoutesDeps {
  storage: StorageDriver;
  noteEvents: NoteEvents;
  accessChanges: AccessChanges;
}

/** `/api/invitations`: notes offered to the signed-in user. */
export function createInvitationRoutes(deps: InvitationRoutesDeps) {
  const { storage, noteEvents, accessChanges } = deps;
  const invitations: AuthedApp = new Hono();

  invitations.get("/", async (c) => {
    const { userId } = c.get("auth");
    const body: InvitationsResponse = {
      invitations: await storage.shares.listInvitations(userId),
    };
    return c.json(body);
  });

  // Accepting keeps the note's key: the recipient's client opened what it
  // was offered and sends it back wrapped under its own notes key. An
  // invitation still waiting for a key cannot be accepted yet.
  invitations.post(
    "/:noteId/accept",
    zValidator("json", heldKeySchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const noteId = c.req.param("noteId") as string;
      const held = c.req.valid("json");
      const invitation = await storage.shares.getInvitation(noteId, userId);
      if (!invitation) throw new HttpError(404, "Invitation not found");
      if (held.keyVersion !== invitation.keyVersion) {
        throw new HttpError(409, "The note is under another key now");
      }
      if (!(await storage.shares.accept(noteId, userId, nowIso(), held))) {
        throw new HttpError(404, "Invitation not found");
      }
      const note = await storage.notes.getById(noteId, userId);
      if (!note) throw new HttpError(404, "Invitation not found");
      // The user's other tabs still show the invitation.
      noteEvents.answered(noteId, userId);
      await noteEvents.changed(noteId);
      // Whoever is looking at the note right now shows up for them at once.
      accessChanges.announce({ noteId, userIds: [userId], change: "gained" });
      const body: NoteResponse<SealedNote> = { note };
      return c.json(body);
    },
  );

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

  return invitations;
}
