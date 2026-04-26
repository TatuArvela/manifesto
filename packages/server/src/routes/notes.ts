import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { AuthProvider } from "../auth/types.js";
import type { ServerConfig } from "../config.js";
import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import { noteCreateSchema, noteUpdateSchema } from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";
import type { Broadcaster } from "../ws/broadcaster.js";

interface NotesDeps {
  storage: StorageDriver;
  authProvider: AuthProvider;
  cfg: ServerConfig;
  broadcaster: Broadcaster;
}

export function createNotesRoutes(deps: NotesDeps) {
  const notes = new Hono<{ Variables: { auth: AuthContext } }>();
  notes.use("*", createAuthMiddleware(deps.authProvider));

  notes.get("/", async (c) => {
    const { userId } = c.get("auth");
    const list = await deps.storage.notes.listByUser(userId);
    return c.json({ notes: list });
  });

  notes.get("/:id", async (c) => {
    const { userId } = c.get("auth");
    const id = c.req.param("id") as string;
    const note = await deps.storage.notes.getById(id, userId);
    if (!note) {
      throw new HttpError(404, "Note not found");
    }
    return c.json({ note });
  });

  notes.post(
    "/",
    zValidator("json", noteCreateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const data = c.req.valid("json");
      const now = nowIso();
      const note = await deps.storage.notes.insert({
        id: newId(),
        userId,
        data,
        createdAt: now,
        updatedAt: now,
      });
      deps.broadcaster.emit(userId, { type: "note:created", note });
      return c.json({ note }, 201);
    },
  );

  notes.put(
    "/:id",
    zValidator("json", noteUpdateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const id = c.req.param("id") as string;
      const changes = c.req.valid("json");
      const ifMatch = c.req.header("If-Match");
      // Atomic compare-and-set: storage.notes.update with an
      // `expectedUpdatedAt` only touches the row if its current
      // updated_at still matches. A null result means one of:
      //   (a) the note doesn't exist or doesn't belong to this user (404)
      //   (b) the note exists but updated_at moved on (412 + current note)
      const updated = await deps.storage.notes.update(
        id,
        userId,
        changes,
        nowIso(),
        ifMatch,
      );
      if (!updated) {
        const current = await deps.storage.notes.getById(id, userId);
        if (!current) {
          throw new HttpError(404, "Note not found");
        }
        if (ifMatch !== undefined && current.updatedAt !== ifMatch) {
          // 412 carries the current note so the client can run a 3-way
          // merge and retry without re-fetching.
          return c.json({ error: "Note has changed", note: current }, 412);
        }
        // Note exists and matched — but UPDATE found nothing. This shouldn't
        // happen in practice; treat as 404 so the client retries cleanly.
        throw new HttpError(404, "Note not found");
      }
      deps.broadcaster.emit(userId, { type: "note:updated", note: updated });
      return c.json({ note: updated });
    },
  );

  notes.delete("/:id", async (c) => {
    const { userId } = c.get("auth");
    const id = c.req.param("id") as string;
    const deleted = await deps.storage.notes.delete(id, userId);
    if (!deleted) {
      throw new HttpError(404, "Note not found");
    }
    deps.broadcaster.emit(userId, { type: "note:deleted", id });
    return c.body(null, 204);
  });

  return notes;
}
