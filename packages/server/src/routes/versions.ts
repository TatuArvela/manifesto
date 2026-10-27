import { NOTE_VERSION_MAX_AGE_DAYS, roleOf } from "@manifesto/shared";
import type { Hono } from "hono";
import { claimImages } from "#/attachments/store.ts";
import { nowIso } from "#/lib/time.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { ClaimedImages, StorageDriver } from "#/storage/types.ts";
import { tokenKeys, versionBody, versionsOut } from "./noteCodec.ts";

type AuthedApp = Hono<{ Variables: { auth: AuthContext } }>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The time under which to keep a version: the time that a client brought, when
 * it is a real time within the life of the history and not in the future.
 * Otherwise, now. Thus, a history kept in a browser comes across with its own
 * dates, and a client cannot put a version where it would never be pruned.
 */
export function versionTimestamp(
  asked: string | undefined,
  now: string,
): string {
  if (asked === undefined) return now;
  const at = Date.parse(asked);
  const nowMs = Date.parse(now);
  if (Number.isNaN(at) || at > nowMs) return now;
  if (at < nowMs - NOTE_VERSION_MAX_AGE_DAYS * DAY_MS) return now;
  return new Date(at).toISOString();
}

/**
 * `/api/v1/notes/:id/versions`: the version history of connected mode, the same
 * for all persons who have the note. All persons who can read the note can read
 * it. Only those who can change the text (owner, editors) can add to it.
 */
export function registerVersionRoutes(
  notes: AuthedApp,
  { storage }: { storage: StorageDriver },
) {
  notes.get("/:id/versions", async (c) => {
    const { userId } = c.get("auth");
    const keys = tokenKeys(c);
    const id = c.req.param("id") as string;
    const note = await storage.notes.getById(id, userId);
    if (!note) throw new HttpError(404, "Note not found");
    return c.json({
      versions: await versionsOut(keys, note, await storage.versions.list(id)),
    });
  });

  notes.post("/:id/versions", async (c) => {
    const { userId } = c.get("auth");
    const keys = tokenKeys(c);
    const id = c.req.param("id") as string;
    const note = await storage.notes.getById(id, userId);
    if (!note) throw new HttpError(404, "Note not found");
    if (roleOf(note) === "view") {
      throw new HttpError(
        403,
        "Your role on this note does not allow editing it",
      );
    }
    const version = await versionBody(c, keys, note);
    if (!version) {
      throw new HttpError(409, "This token cannot open the note's key");
    }
    // As on a note write: the images of a version belong to the owner of the
    // note.
    let images: { sealed: string; refs: ClaimedImages } | undefined;
    if (version.images !== undefined && version.imageRefs !== undefined) {
      const access = await storage.notes.access(id, userId);
      if (!access) throw new HttpError(404, "Note not found");
      images = {
        sealed: version.images,
        refs: await claimImages(storage, version.imageRefs, access.ownerId),
      };
    }
    // The client selects the id, or the server for a token. The sealed values
    // are bound to it.
    const added = await storage.versions.add({
      id: version.id,
      noteId: id,
      authorId: userId,
      keyVersion: version.keyVersion,
      format: version.format,
      title: version.title,
      content: version.content,
      images,
      createdAt: versionTimestamp(version.timestamp, nowIso()),
    });
    if (!added) throw new HttpError(409, "A version already has this id");
    return c.body(null, 201);
  });
}
