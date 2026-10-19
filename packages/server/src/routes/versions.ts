import { NOTE_VERSION_MAX_AGE_DAYS, roleOf } from "@manifesto/shared";
import type { Hono } from "hono";
import { nowIso } from "#/lib/time.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { tokenKeys, versionBody, versionsOut } from "./noteCodec.ts";

type AuthedApp = Hono<{ Variables: { auth: AuthContext } }>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The time to file a version under: the one a client brought, when it is a
 * real moment within the history's life and not in the future, else now. A
 * history kept in a browser comes across with its own dates this way, and a
 * client cannot file a version where it would never be pruned.
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
 * `/api/v1/notes/:id/versions`: connected mode's version history, the same for
 * everyone holding the note. Anyone who can read the note reads it; only
 * those who can change the text (owner, editors) add to it.
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
    // The id is the client's, or for a token the server's: the sealed values
    // are bound to it.
    const added = await storage.versions.add({
      id: version.id,
      noteId: id,
      authorId: userId,
      keyVersion: version.keyVersion,
      format: version.format,
      title: version.title,
      content: version.content,
      createdAt: versionTimestamp(version.timestamp, nowIso()),
    });
    if (!added) throw new HttpError(409, "A version already has this id");
    return c.body(null, 201);
  });
}
