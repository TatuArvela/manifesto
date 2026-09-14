import { zValidator } from "@hono/zod-validator";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AuthProvider } from "../auth/types.js";
import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { AccessChanges } from "../sharing/accessChanges.js";
import type { NoteEvents } from "../sharing/noteEvents.js";
import { NoteAccessError, type StorageDriver } from "../storage/types.js";
import { readPageParams } from "../validation/pageParams.js";
import { noteCreateSchema, noteUpdateSchema } from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";
import type { Broadcaster } from "../ws/broadcaster.js";
import { registerShareRoutes } from "./shares.js";

interface NotesDeps {
  storage: StorageDriver;
  authProvider: AuthProvider;
  broadcaster: Broadcaster;
  noteEvents: NoteEvents;
  accessChanges: AccessChanges;
  /** Optional per-user limiter, mounted after auth. Defined in app.ts so
   * it shares state with /api/search rather than maintaining a per-router
   * bucket map. */
  rateLimit?: MiddlewareHandler;
}

/**
 * The `trashed_at` stamp that goes with a `trashed` flag. Trashing stamps the
 * server clock, restoring clears it, and a change that doesn't mention
 * `trashed` leaves the existing stamp alone.
 *
 * Re-trashing an already-trashed note restarts its 30 days. That is the safe
 * direction (it can only delay a hard delete, never bring one forward), and
 * it costs a read of the current row to do better.
 */
function trashStamp(
  trashed: boolean | undefined,
  now: string,
): { trashedAt?: string | null } {
  if (trashed === undefined) return {};
  return { trashedAt: trashed ? now : null };
}

export function createNotesRoutes(deps: NotesDeps) {
  const notes = new Hono<{ Variables: { auth: AuthContext } }>();
  notes.use("*", createAuthMiddleware(deps.authProvider));
  if (deps.rateLimit) notes.use("*", deps.rateLimit);

  notes.get("/", async (c) => {
    const { userId } = c.get("auth");
    const page = readPageParams(c.req.query("limit"), c.req.query("cursor"));
    return c.json(await deps.storage.notes.listByUser(userId, page));
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
      const fields = c.req.valid("json");
      const now = nowIso();
      const note = await deps.storage.notes.insert({
        id: newId(),
        userId,
        data: { ...fields, trashedAt: fields.trashed ? now : null },
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
      const fields = c.req.valid("json");
      const now = nowIso();
      const changes = { ...fields, ...trashStamp(fields.trashed, now) };
      const ifMatch = c.req.header("If-Match");
      // Atomic compare-and-set: storage.notes.update with an
      // `expectedUpdatedAt` only touches the row if its current
      // updated_at still matches. A null result means one of:
      //   (a) the note doesn't exist or this user cannot see it (404)
      //   (b) the note exists but updated_at moved on (412 + current note)
      let updated: Awaited<ReturnType<typeof deps.storage.notes.update>>;
      try {
        updated = await deps.storage.notes.update(
          id,
          userId,
          changes,
          now,
          ifMatch,
        );
      } catch (err) {
        // A recipient reaching for the trash, or a viewer for the note itself.
        if (err instanceof NoteAccessError) {
          throw new HttpError(
            403,
            `Your role on this note does not allow changing ${err.fields.join(", ")}`,
          );
        }
        throw err;
      }
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
        // Note exists and matched, but UPDATE found nothing. This shouldn't
        // happen in practice; treat as 404 so the client retries cleanly.
        throw new HttpError(404, "Note not found");
      }
      // Everyone holding the note gets their own copy of it, the writer's
      // other tabs included.
      await deps.noteEvents.changed(id, {
        trashChanged: fields.trashed !== undefined,
      });
      return c.json({ note: updated });
    },
  );

  notes.delete("/:id", async (c) => {
    const { userId } = c.get("auth");
    const id = c.req.param("id") as string;
    const access = await deps.storage.notes.access(id, userId);
    if (access && access.role !== "owner") {
      throw new HttpError(403, "Only the owner can delete this note");
    }
    // Read before the delete, which takes the shares with it by cascade.
    const shares = (await deps.storage.shares.audience(id))?.shares ?? [];
    const deleted = await deps.storage.notes.delete(id, userId);
    if (!deleted) {
      throw new HttpError(404, "Note not found");
    }
    deps.broadcaster.emit(userId, { type: "note:deleted", id });
    deps.noteEvents.ended(shares);
    return c.body(null, 204);
  });

  registerShareRoutes(notes, deps);

  return notes;
}
