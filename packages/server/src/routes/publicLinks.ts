import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import {
  attachmentIdOf,
  type PublicLink,
  type PublicLinkResponse,
  type PublicLinksResponse,
  type PublicNote,
  type PublicNoteLockedResponse,
  type PublicNoteResponse,
  type SealedNote,
} from "@manifesto/shared";
import { type Context, Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import type { ServerConfig } from "#/config.ts";
import { createExpiringCounter } from "#/lib/expiringCounter.ts";
import { hashPassword, verifyPassword } from "#/lib/password.ts";
import { nowIso } from "#/lib/time.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver, StoredPublicLink } from "#/storage/types.ts";
import {
  publicLinkCreateSchema,
  publicLinkUnlockSchema,
} from "#/validation/sharingSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";

type AuthedApp = Hono<{ Variables: { auth: AuthContext } }>;

interface PublicLinkDeps {
  storage: StorageDriver;
  cfg: ServerConfig;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long after the last view of a link its pictures still load. The request
 * that shows the note uses up a link with a limit of one view, and the browser
 * gets the images of that note a moment later.
 */
const USED_UP_IMAGE_GRACE_MS = 10 * 60 * 1000;

/**
 * The number of wrong passwords that one link accepts in one hour, from all
 * places.
 */
const UNLOCK_FAILURES_PER_LINK = 20;

/** The view of a link for the owner: all but the hash and the copy. */
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
    sealedLinkKey: link.sealedLinkKey,
  };
}

/**
 * What a public link gives of a note. See `PublicNote`. A live link gives the
 * own sealed fields of the note, which the page opens with the note key in the
 * link. A snapshot gives the copy that its owner sealed for it. None of it
 * opens without the link key, which is in the address and never here.
 */
function publicNoteOf(link: StoredPublicLink, live: SealedNote): PublicNote {
  const from = link.snapshot ?? live;
  return {
    id: live.id,
    keyVersion: link.snapshot ? 1 : live.keyVersion,
    format: link.snapshot ? (link.snapshot.format ?? 1) : live.format,
    title: from.title,
    content: from.content,
    font: from.font,
    images: from.images,
    linkPreviews: from.linkPreviews,
    updatedAt: from.updatedAt,
  };
}

/**
 * What proves that a password was given, for the attachment requests that
 * follow. It is derived from the token and the hash of the password. Thus,
 * nobody can make it without the database, and it stops if the link goes.
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
 * `/api/v1/notes/:id/links`: the public links of a note, which its owner
 * manages. Registered on the notes router, behind its authentication.
 */
export function registerPublicLinkRoutes(
  notes: AuthedApp,
  { storage, cfg }: PublicLinkDeps,
): void {
  async function ownNote(c: Context, noteId: string): Promise<SealedNote> {
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
      // A plugin writes an automatic note again in the browser of its owner.
      // The copy of the server is not what the owner sees.
      if (note.readonly) {
        throw new HttpError(422, "Automatic notes cannot be published");
      }
      const body = c.req.valid("json");
      const now = nowIso();
      // A snapshot serves only pictures that the note itself names. The copy is
      // sealed. Thus, what it shows is what the owner says, and the server
      // checks that here.
      if (body.snapshot) {
        const named = new Set(await storage.notes.attachmentIds(note.id));
        if (
          !body.snapshot.refs.every((ref) => named.has(attachmentIdOf(ref)))
        ) {
          throw new HttpError(422, "snapshot.refs: Not this note's images");
        }
      }
      const link: StoredPublicLink = {
        token: randomBytes(16).toString("base64url"),
        noteId: note.id,
        ownerId: userId,
        mode: body.mode,
        snapshot: body.snapshot ? { ...body.snapshot, updatedAt: now } : null,
        wrappedKey: body.wrappedKey ?? null,
        sealedLinkKey: body.sealedLinkKey,
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
 * `/api/v1/public/:token`: a note as a public link shows it, to all persons
 * with the token, with no account.
 *
 * All failures of a link (never made, revoked, expired, at its view limit, its
 * note in the trash or gone) answer the same 404. Thus, a caller learns nothing
 * about which. With `PUBLIC_LINKS=off`, the protection answers first, with the
 * 404 of a route that does not exist. Nothing here is cached. A view counts
 * when the server gives out the note, and a revoked link must stop immediately.
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

  /** For each link, the end of the unlocks in progress. */
  const unlocking = new Map<string, Promise<void>>();

  /**
   * Runs the unlocks of one link one after the other. The code reads the
   * failure count, verifies the password and counts the failure. A verification
   * takes a long time. Thus, if requests arrive together, they would otherwise
   * all read the count before any of them added to it.
   */
  function inTurn<T>(token: string, work: () => Promise<T>): Promise<T> {
    const run = (unlocking.get(token) ?? Promise.resolve()).then(work);
    const settled = run.then(
      () => {},
      () => {},
    );
    unlocking.set(token, settled);
    void settled.then(() => {
      if (unlocking.get(token) === settled) unlocking.delete(token);
    });
    return run;
  }

  /** The link and what it shows, if it shows anything at `now`. */
  async function open(
    token: string,
    now: string,
  ): Promise<{ link: StoredPublicLink; note: PublicNote }> {
    const link = await storage.publicLinks.get(token);
    if (!link) throw notFound();
    if (link.expiresAt !== null && link.expiresAt <= now) throw notFound();
    // The trash takes the links of a note offline, also snapshots. A restore
    // brings them back.
    const live = await storage.notes.getById(link.noteId, link.ownerId);
    if (!live || live.trashed) throw notFound();
    return { link, note: publicNoteOf(link, live) };
  }

  async function view(link: StoredPublicLink, note: PublicNote, now: string) {
    if (!(await storage.publicLinks.recordView(link.token, now))) {
      throw notFound();
    }
    return {
      note,
      wrappedKey: link.wrappedKey,
      access: accessKey(link),
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
      const { passwordHash } = link;
      if (!passwordHash) throw notFound();
      const { password } = c.req.valid("json");
      await inTurn(link.token, async () => {
        const failures = unlockFailures.peek(link.token, Date.now());
        if (failures && failures.count >= UNLOCK_FAILURES_PER_LINK) {
          throw new HttpError(429, "Too many attempts");
        }
        if (!(await verifyPassword(passwordHash, password))) {
          unlockFailures.hit(link.token, Date.now());
          throw new HttpError(403, "Wrong password");
        }
      });
      return c.json(await view(link, note, now));
    },
  );

  routes.get("/:token/attachments/:id", async (c) => {
    const now = nowIso();
    const { link } = await open(c.req.param("token"), now);
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
    // Only a picture that the note shows. The token is not a key to the other
    // attachments of the owner.
    const shown = link.snapshot
      ? link.snapshot.refs.map(attachmentIdOf)
      : await storage.notes.attachmentIds(link.noteId);
    if (!shown.includes(id)) throw notFound();
    const attachment = await storage.attachments.get(id);
    if (!attachment) throw notFound();
    // Sealed, as all images. The page opens it with the key that the note has
    // for it.
    return c.body(new Uint8Array(attachment.data), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(attachment.size),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
  });

  return routes;
}
