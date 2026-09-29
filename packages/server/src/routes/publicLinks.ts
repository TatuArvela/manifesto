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
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import { referencesOf } from "../storage/attachmentMapping.js";
import type { StorageDriver, StoredPublicLink } from "../storage/types.js";
import {
  publicLinkCreateSchema,
  publicLinkUnlockSchema,
} from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

type AuthedApp = Hono<{ Variables: { auth: AuthContext } }>;

interface PublicLinkDeps {
  storage: StorageDriver;
  cfg: ServerConfig;
}

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
      };
      await storage.publicLinks.create(link);
      audit(storage, c, {
        action: "link.created",
        actorId: userId,
        noteId: note.id,
        detail: { mode: link.mode },
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
}: Pick<PublicLinkDeps, "storage">) {
  const routes = new Hono();
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
    return { note, access: accessKey(link) } satisfies PublicNoteResponse;
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
