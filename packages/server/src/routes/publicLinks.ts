import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import type {
  Note,
  PublicLink,
  PublicLinkResponse,
  PublicLinksResponse,
  PublicNote,
  PublicNoteLockedResponse,
  PublicNoteResponse,
} from "@manifesto/shared";
import { type Context, Hono } from "hono";
import { audit } from "../audit/audit.js";
import type { ServerConfig } from "../config.js";
import { createExpiringCounter } from "../lib/expiringCounter.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { NoteEvents } from "../sharing/noteEvents.js";
import { referencesOf } from "../storage/attachmentMapping.js";
import type { StorageDriver, StoredPublicLink } from "../storage/types.js";
import {
  publicLinkCreateSchema,
  publicLinkUnlockSchema,
  publicNoteUpdateSchema,
} from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

type AuthedApp = Hono<{ Variables: { auth: AuthContext } }>;

interface PublicLinkDeps {
  storage: StorageDriver;
  cfg: ServerConfig;
}

/** Writes one link takes in an hour, from anywhere: an editor saving as it
 * goes stays far below it, and a script hammering a note does not. */
const EDITS_PER_LINK = 600;
/**
 * How long a link's edits count as one sitting. The first in a sitting keeps
 * a version of the note as it was and writes the audit entry; the rest of an
 * editor's saves do neither, or one visit would fill the history and the log.
 */
const EDIT_SITTING_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long after a link's last view its pictures still load. A link limited
 * to one view is used up by the request that shows the note, and the images
 * that note names are fetched a moment later.
 */
const USED_UP_IMAGE_GRACE_MS = 10 * 60 * 1000;

/** Wrong passwords one link takes in an hour, from anywhere. */
const UNLOCK_FAILURES_PER_LINK = 20;

/** The owner's view of a link: everything but the hash and the copy. */
export function toPublicLink(link: StoredPublicLink): PublicLink {
  return {
    token: link.token,
    noteId: link.noteId,
    mode: link.mode,
    expiresAt: link.expiresAt,
    hasPassword: link.hasPassword,
    maxViews: link.maxViews,
    viewCount: link.viewCount,
    lastViewedAt: link.lastViewedAt,
    createdAt: link.createdAt,
    canEdit: link.canEdit === true,
  };
}

/** What a public link shows of a note; see `PublicNote`. */
function publicNoteOf(note: Note): PublicNote {
  return {
    title: note.title,
    content: note.content,
    color: note.color,
    font: note.font,
    images: note.images,
    linkPreviews: note.linkPreviews,
    updatedAt: note.updatedAt,
  };
}

/**
 * What proves a password was given, for the attachment requests that follow:
 * derived from the token and the password's hash, so it cannot be made
 * without the database, and stops working if the link goes.
 */
function accessKey(link: StoredPublicLink): string | null {
  if (!link.passwordHash) return null;
  return createHash("sha256")
    .update(`${link.token}:${link.passwordHash}`)
    .digest("base64url");
}

function sameKey(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `/api/notes/:id/links`: a note's public links, managed by its owner.
 * Registered on the notes router, behind its authentication.
 */
export function registerPublicLinkRoutes(
  notes: AuthedApp,
  { storage, cfg }: PublicLinkDeps,
): void {
  async function ownNote(c: Context, noteId: string): Promise<Note> {
    const { userId } = c.get("auth") as AuthContext;
    const access = await storage.notes.access(noteId, userId);
    if (!access) throw new HttpError(404, "Note not found");
    if (access.role !== "owner") {
      throw new HttpError(403, "Only the owner can publish this note");
    }
    const note = await storage.notes.getById(noteId, userId);
    if (!note) throw new HttpError(404, "Note not found");
    return note;
  }

  notes.get("/:id/links", async (c) => {
    const note = await ownNote(c, c.req.param("id") as string);
    const links = await storage.publicLinks.listByNote(note.id);
    return c.json({
      links: links.map(toPublicLink),
    } satisfies PublicLinksResponse);
  });

  notes.post(
    "/:id/links",
    zValidator("json", publicLinkCreateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const note = await ownNote(c, c.req.param("id") as string);
      if (note.trashed) {
        throw new HttpError(409, "A note in the trash cannot be published");
      }
      // A plugin rewrites an automatic note in its owner's browser; the
      // server's copy is not what the owner sees.
      if (note.readonly) {
        throw new HttpError(422, "Automatic notes cannot be published");
      }
      const body = c.req.valid("json");
      if (body.canEdit) {
        // A snapshot is the note as it was, which there is nothing to edit
        // in; and a link that runs out after so many views would stop its
        // holder half way through an edit.
        if (body.mode !== "live") {
          throw new HttpError(422, "canEdit: Only a live link can edit");
        }
        if (body.maxViews !== undefined) {
          throw new HttpError(
            422,
            "canEdit: A link that can edit cannot be limited by views",
          );
        }
      }
      const now = nowIso();
      const link: StoredPublicLink = {
        token: randomBytes(16).toString("base64url"),
        noteId: note.id,
        ownerId: userId,
        mode: body.mode,
        snapshot: body.mode === "snapshot" ? publicNoteOf(note) : null,
        passwordHash: body.password
          ? await hashPassword(body.password, cfg)
          : null,
        hasPassword: body.password !== undefined,
        expiresAt:
          body.expiresInDays === undefined
            ? null
            : new Date(
                Date.parse(now) + body.expiresInDays * DAY_MS,
              ).toISOString(),
        maxViews: body.maxViews ?? null,
        viewCount: 0,
        lastViewedAt: null,
        createdAt: now,
        canEdit: body.canEdit === true,
      };
      await storage.publicLinks.create(link);
      audit(storage, c, {
        action: "link.created",
        actorId: userId,
        noteId: note.id,
        detail: { mode: link.mode, ...(link.canEdit && { canEdit: "yes" }) },
      });
      return c.json(
        { link: toPublicLink(link) } satisfies PublicLinkResponse,
        201,
      );
    },
  );

  notes.delete("/:id/links/:token", async (c) => {
    const { userId } = c.get("auth");
    const note = await ownNote(c, c.req.param("id") as string);
    const token = c.req.param("token") as string;
    if (!(await storage.publicLinks.delete(token, note.id))) {
      throw new HttpError(404, "Link not found");
    }
    audit(storage, c, {
      action: "link.revoked",
      actorId: userId,
      noteId: note.id,
    });
    return c.body(null, 204);
  });
}

/**
 * `/api/public/:token`: a note as a public link shows it, to anyone holding
 * the token, with no account.
 *
 * Every way a link can fail (never made, revoked, expired, used up, its note
 * in the trash or gone) answers the same 404, so a caller learns nothing
 * about which. With `PUBLIC_LINKS=off` the protection answers first, with the
 * 404 of a route that does not exist. Nothing here is cached: a view is
 * counted when the note is handed out, and a revoked link must stop at once.
 */
export function createPublicRoutes({
  storage,
  noteEvents,
}: Pick<PublicLinkDeps, "storage"> & { noteEvents: NoteEvents }) {
  const routes = new Hono();
  const editCounts = createExpiringCounter({
    windowMs: 60 * 60 * 1000,
    maxEntries: 10_000,
  });
  const editSittings = createExpiringCounter({
    windowMs: EDIT_SITTING_MS,
    maxEntries: 10_000,
  });
  const unlockFailures = createExpiringCounter({
    windowMs: 60 * 60 * 1000,
    maxEntries: 10_000,
  });

  routes.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
  });

  const notFound = () => new HttpError(404, "Link not found");

  /** The link and what it shows, if it shows anything at all at `now`. */
  async function open(
    token: string,
    now: string,
  ): Promise<{ link: StoredPublicLink; note: PublicNote }> {
    const link = await storage.publicLinks.get(token);
    if (!link) throw notFound();
    if (link.expiresAt !== null && link.expiresAt <= now) throw notFound();
    // The trash takes a note's links offline, snapshots included; restoring
    // it brings them back.
    const live = await storage.notes.getById(link.noteId, link.ownerId);
    if (!live || live.trashed) throw notFound();
    return { link, note: link.snapshot ?? publicNoteOf(live) };
  }

  async function view(link: StoredPublicLink, note: PublicNote, now: string) {
    if (!(await storage.publicLinks.recordView(link.token, now))) {
      throw notFound();
    }
    return {
      note,
      access: accessKey(link),
      ...(link.canEdit && { canEdit: true }),
    } satisfies PublicNoteResponse;
  }

  routes.get("/:token", async (c) => {
    const now = nowIso();
    const { link, note } = await open(c.req.param("token"), now);
    const usedUp = link.maxViews !== null && link.viewCount >= link.maxViews;
    if (usedUp) throw notFound();
    if (link.hasPassword) {
      return c.json(
        { passwordRequired: true } satisfies PublicNoteLockedResponse,
        401,
      );
    }
    return c.json(await view(link, note, now));
  });

  routes.post(
    "/:token/unlock",
    zValidator("json", publicLinkUnlockSchema, validatorHook),
    async (c) => {
      const now = nowIso();
      const { link, note } = await open(c.req.param("token"), now);
      if (!link.passwordHash) throw notFound();
      const failures = unlockFailures.peek(link.token, Date.now());
      if (failures && failures.count >= UNLOCK_FAILURES_PER_LINK) {
        throw new HttpError(429, "Too many attempts");
      }
      const { password } = c.req.valid("json");
      if (!(await verifyPassword(link.passwordHash, password))) {
        unlockFailures.hit(link.token, Date.now());
        throw new HttpError(403, "Wrong password");
      }
      return c.json(await view(link, note, now));
    },
  );

  /**
   * `PUT /api/public/:token`: the holder of a link that can edit changes the
   * note's title or text. There is no account behind the request, so what it
   * may do is as narrow as the link: those two fields of that one note, and
   * only on top of the copy it was shown (`If-Match`), so it cannot write
   * over an edit it never saw.
   *
   * The write is the owner's as far as storage goes, and reaches open editors
   * the way any write from outside the editor does (an API token's, MCP's):
   * as a row newer than their document. The note as it stood is kept as a
   * version first, marked `via: "link"`, and the edit is in the audit log
   * with the link named and the owner as its target, so the owner's own
   * Activity page shows that their note was changed and through which link.
   */
  routes.put(
    "/:token",
    zValidator("json", publicNoteUpdateSchema, validatorHook),
    async (c) => {
      const now = nowIso();
      const token = c.req.param("token");
      const { link } = await open(token, now);
      // The same answer as a link that does not exist: whether a link can
      // edit is not something to tell someone who is guessing at it.
      if (!link.canEdit || link.mode !== "live") throw notFound();
      const key = accessKey(link);
      if (key !== null && !sameKey(c.req.header("X-Link-Access"), key)) {
        throw notFound();
      }
      const ifMatch = c.req.header("If-Match");
      if (!ifMatch) {
        throw new HttpError(428, "If-Match: Say which copy this edit is of");
      }
      const edits = editCounts.peek(link.token, Date.now());
      if (edits && edits.count >= EDITS_PER_LINK) {
        throw new HttpError(429, "Too many edits through this link");
      }
      editCounts.hit(link.token, Date.now());

      const before = await storage.notes.getById(link.noteId, link.ownerId);
      if (!before || before.trashed) throw notFound();
      const conflict = (current: Note) =>
        c.json(
          {
            note: publicNoteOf(current),
            access: key,
            canEdit: true,
          } satisfies PublicNoteResponse,
          412,
        );
      if (before.updatedAt !== ifMatch) return conflict(before);

      const changes = c.req.valid("json");
      const updated = await storage.notes.update(
        link.noteId,
        link.ownerId,
        {
          ...(changes.title !== undefined && { title: changes.title }),
          ...(changes.content !== undefined && { content: changes.content }),
        },
        now,
        ifMatch,
      );
      if (!updated) {
        // Changed between the read above and the write.
        const current = await storage.notes.getById(link.noteId, link.ownerId);
        if (!current || current.trashed) throw notFound();
        return conflict(current);
      }

      const sitting = editSittings.peek(link.token, Date.now());
      if (!sitting) {
        editSittings.hit(link.token, Date.now());
        await storage.versions.add({
          id: newId(),
          noteId: link.noteId,
          authorId: link.ownerId,
          title: before.title,
          content: before.content,
          createdAt: now,
          via: "link",
        });
        audit(storage, c, {
          action: "link.note_edited",
          targetId: link.ownerId,
          noteId: link.noteId,
          // Enough of the token to tell one link from another in the list,
          // not enough to be the link.
          detail: { link: `${link.token.slice(0, 6)}...` },
        });
      }
      await noteEvents.changed(link.noteId);
      return c.json({
        note: publicNoteOf(updated),
        access: key,
        canEdit: true,
      } satisfies PublicNoteResponse);
    },
  );

  routes.get("/:token/attachments/:id", async (c) => {
    const now = nowIso();
    const { link, note } = await open(c.req.param("token"), now);
    const id = c.req.param("id");
    const usedUp = link.maxViews !== null && link.viewCount >= link.maxViews;
    if (
      usedUp &&
      (link.lastViewedAt === null ||
        Date.parse(now) - Date.parse(link.lastViewedAt) >
          USED_UP_IMAGE_GRACE_MS)
    ) {
      throw notFound();
    }
    const key = accessKey(link);
    if (key !== null && !sameKey(c.req.header("X-Link-Access"), key)) {
      throw notFound();
    }
    // Only a picture the note shows: the token is not a key to the owner's
    // other attachments.
    const shown = referencesOf({
      images: JSON.stringify(note.images),
      link_previews: JSON.stringify(note.linkPreviews),
    });
    if (!shown.includes(id)) throw notFound();
    const attachment = await storage.attachments.get(id);
    if (!attachment) throw notFound();
    return c.body(new Uint8Array(attachment.data), 200, {
      "Content-Type": attachment.contentType,
      "Content-Length": String(attachment.size),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
  });

  return routes;
}
