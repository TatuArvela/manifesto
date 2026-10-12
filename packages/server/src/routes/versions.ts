import { zValidator } from "@hono/zod-validator";
import {
  NOTE_VERSION_MAX_AGE_DAYS,
  type SealedNoteVersion,
} from "@manifesto/shared";
import type { Hono } from "hono";
import { nowIso } from "../lib/time.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import { sealedVersionCreateSchema } from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

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
 * `/api/notes/:id/versions`: connected mode's version history, the same for
 * everyone holding the note. Anyone who can read the note reads it; only
 * those who can change the text (owner, editors) add to it.
 */
export function registerVersionRoutes(
  notes: AuthedApp,
  { storage }: { storage: StorageDriver },
) {
  notes.get("/:id/versions", async (c) => {
    const { userId } = c.get("auth");
    const id = c.req.param("id") as string;
    if (!(await storage.notes.access(id, userId))) {
      throw new HttpError(404, "Note not found");
    }
    const body: { versions: SealedNoteVersion[] } = {
      versions: await storage.versions.list(id),
    };
    return c.json(body);
  });

  notes.post(
    "/:id/versions",
    zValidator("json", sealedVersionCreateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const id = c.req.param("id") as string;
      const access = await storage.notes.access(id, userId);
      if (!access) throw new HttpError(404, "Note not found");
      if (access.role === "view") {
        throw new HttpError(
          403,
          "Your role on this note does not allow editing it",
        );
      }
      const version = c.req.valid("json");
      // The client chooses the id, which the sealed values are bound to.
      const added = await storage.versions.add({
        id: version.id,
        noteId: id,
        authorId: userId,
        keyVersion: version.keyVersion,
        title: version.title,
        content: version.content,
        createdAt: versionTimestamp(version.timestamp, nowIso()),
      });
      if (!added) throw new HttpError(409, "A version already has this id");
      return c.body(null, 201);
    },
  );
}
