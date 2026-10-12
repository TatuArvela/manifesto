import { zValidator } from "@hono/zod-validator";
import {
  MAX_NOTES_PAGE_SIZE,
  type NotesImportResponse,
  roleOf,
} from "@manifesto/shared";
import { Hono } from "hono";
import { claimImages } from "../attachments/store.js";
import type { ServerConfig } from "../config.js";
import { nowIso } from "../lib/time.js";
import type { Mailer } from "../mail/mailer.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { AccessChanges } from "../sharing/accessChanges.js";
import type { NoteEvents } from "../sharing/noteEvents.js";
import type { TeamShares } from "../sharing/teamShares.js";
import {
  NoteAccessError,
  type StorageDriver,
  type StoredNoteUpdate,
} from "../storage/types.js";
import { readPageParams } from "../validation/pageParams.js";
import {
  sealedNoteCreateSchema,
  sealedNotesImportSchema,
  sealedNoteUpdateSchema,
} from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";
import { registerCommentRoutes } from "./comments.js";
import { registerPublicLinkRoutes } from "./publicLinks.js";
import { registerShareRoutes } from "./shares.js";
import { registerTeamShareRoutes } from "./teams.js";
import { registerVersionRoutes } from "./versions.js";

interface NotesDeps {
  storage: StorageDriver;
  noteEvents: NoteEvents;
  accessChanges: AccessChanges;
  /** Optional per-user limiter, mounted after auth. Defined in app.ts so
   * it shares state with /api/search rather than maintaining a per-router
   * bucket map. */
  mail?: { mailer: Mailer; appUrl: string } | null;
  /** For the public link routes, which hash passwords and may be off. */
  cfg: ServerConfig;
  teamShares: TeamShares;
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

  /**
   * Deletes a note the user owns and tells everyone who held it. False when
   * there was no such note of theirs.
   */
  async function deleteOwnNote(id: string, userId: string): Promise<boolean> {
    // Read before the delete, which takes the shares with it by cascade.
    const shares = (await deps.storage.shares.audience(id))?.shares ?? [];
    if (!(await deps.storage.notes.delete(id, userId))) return false;
    deps.noteEvents.deleted(id, userId, shares);
    return true;
  }

  /** Every note the user owns, as opposed to those shared with them. */
  async function ownNoteIds(userId: string): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await deps.storage.notes.listByUser(userId, {
        limit: MAX_NOTES_PAGE_SIZE,
        ...(cursor !== undefined && { cursor }),
      });
      for (const note of page.notes) {
        if (roleOf(note) === "owner") ids.push(note.id);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return ids;
  }

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

  // The client chooses a new note's id, since everything it sealed is bound
  // to it, so an id can arrive that is already someone's.
  notes.post(
    "/",
    zValidator("json", sealedNoteCreateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const { id, imageRefs, previewRefs, ...fields } = c.req.valid("json");
      if (await deps.storage.notes.exists(id)) {
        throw new HttpError(409, "A note already has this id");
      }
      const now = nowIso();
      const note = await deps.storage.notes.insert({
        id,
        userId,
        data: {
          ...fields,
          imageRefs: await claimImages(
            deps.storage,
            imageRefs,
            userId,
            userId,
            now,
          ),
          previewRefs: await claimImages(
            deps.storage,
            previewRefs,
            userId,
            userId,
            now,
          ),
          trashedAt: fields.trashed ? now : null,
        },
        createdAt: now,
        updatedAt: now,
      });
      deps.noteEvents.created(note, userId);
      return c.json({ note }, 201);
    },
  );

  // A backup, or part of one. A note keeps its id and creation time, so a
  // backup imported twice updates the same notes rather than duplicating them.
  notes.post(
    "/import",
    zValidator("json", sealedNotesImportSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const result: NotesImportResponse = {
        created: 0,
        updated: 0,
        skipped: 0,
      };
      const taken: string[] = [];
      for (const item of c.req.valid("json").notes) {
        const { id, createdAt, imageRefs, previewRefs, ...fields } = item;
        const now = nowIso();
        const access = await deps.storage.notes.access(id, userId);
        if (access && access.role !== "owner") {
          result.skipped++;
          continue;
        }
        // Someone else's note has this id. A readable note was given a new
        // one here; a sealed one is bound to its id, so the client has to
        // seal it again under another.
        if (!access && (await deps.storage.notes.exists(id))) {
          taken.push(id);
          continue;
        }
        const data = {
          ...fields,
          imageRefs: await claimImages(
            deps.storage,
            imageRefs,
            userId,
            userId,
            now,
          ),
          previewRefs: await claimImages(
            deps.storage,
            previewRefs,
            userId,
            userId,
            now,
          ),
        };
        if (access) {
          await deps.storage.notes.update(
            id,
            userId,
            { ...data, ...trashStamp(fields.trashed, now) },
            now,
          );
          await deps.noteEvents.changed(id, { trashChanged: true });
          result.updated++;
          continue;
        }
        const note = await deps.storage.notes.insert({
          id,
          userId,
          data: { ...data, trashedAt: fields.trashed ? now : null },
          createdAt: createdAt ? new Date(createdAt).toISOString() : now,
          updatedAt: now,
        });
        deps.noteEvents.created(note, userId);
        result.created++;
      }
      if (taken.length > 0) result.taken = taken;
      return c.json(result);
    },
  );

  notes.put(
    "/:id",
    zValidator("json", sealedNoteUpdateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const id = c.req.param("id") as string;
      const fields = c.req.valid("json");
      const now = nowIso();
      const { imageRefs, previewRefs, ...rest } = fields;
      const changes: StoredNoteUpdate = {
        ...rest,
        ...trashStamp(fields.trashed, now),
      };
      if (imageRefs !== undefined || previewRefs !== undefined) {
        // Stored under the note's owner, whoever is writing. Refused here
        // with the answers the update would give, since references nobody
        // claimed never reach it.
        const access = await deps.storage.notes.access(id, userId);
        if (!access) throw new HttpError(404, "Note not found");
        if (access.role === "view") {
          const named = [
            ...(imageRefs !== undefined ? ["images"] : []),
            ...(previewRefs !== undefined ? ["linkPreviews"] : []),
          ];
          throw new HttpError(
            403,
            `Your role on this note does not allow changing ${named.join(", ")}`,
          );
        }
        if (imageRefs !== undefined) {
          changes.imageRefs = await claimImages(
            deps.storage,
            imageRefs,
            access.ownerId,
            userId,
            now,
          );
        }
        if (previewRefs !== undefined) {
          changes.previewRefs = await claimImages(
            deps.storage,
            previewRefs,
            access.ownerId,
            userId,
            now,
          );
        }
      }
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
        // A viewer reaching for the note itself, or a recipient for what only
        // the owner decides.
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
      // other tabs included. Only the owner's trash hides the note from anyone
      // else; a recipient's is theirs alone.
      await deps.noteEvents.changed(id, {
        trashChanged:
          fields.trashed !== undefined &&
          (updated.sharing?.role ?? "owner") === "owner",
      });
      return c.json({ note: updated });
    },
  );

  notes.delete("/:id", async (c) => {
    const { userId } = c.get("auth");
    const id = c.req.param("id") as string;
    const access = await deps.storage.notes.access(id, userId);
    // Deleting a note shared with you deletes it from your notes: your share
    // goes, and the note stays with its owner and everyone else. This is what
    // emptying it from your own trash does.
    if (access && access.role !== "owner") {
      const removed = await deps.storage.shares.delete(id, userId);
      if (!removed) throw new HttpError(404, "Note not found");
      deps.noteEvents.ended([removed]);
      await deps.noteEvents.changed(id);
      return c.body(null, 204);
    }
    if (!(await deleteOwnNote(id, userId))) {
      throw new HttpError(404, "Note not found");
    }
    return c.body(null, 204);
  });

  // Every note the user owns. Notes shared with them are someone else's, and
  // stay.
  notes.delete("/", async (c) => {
    const { userId } = c.get("auth");
    for (const id of await ownNoteIds(userId)) {
      await deleteOwnNote(id, userId);
    }
    return c.body(null, 204);
  });

  registerShareRoutes(notes, deps);
  registerCommentRoutes(notes, deps);
  registerPublicLinkRoutes(notes, deps);
  registerTeamShareRoutes(notes, deps);
  registerVersionRoutes(notes, deps);

  return notes;
}
