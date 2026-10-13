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
import { noteRekeySchema } from "../validation/schemas.js";
import { registerCommentRoutes } from "./comments.js";
import {
  bodyOf,
  createBody,
  importBody,
  noteOut,
  notesOut,
  tokenKeys,
  updateBody,
} from "./noteCodec.js";
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

  // Every route here answers the app with what is stored, sealed, and a
  // token that carries keys with the same notes opened; see `noteCodec.ts`.
  notes.get("/", async (c) => {
    const { userId } = c.get("auth");
    const keys = tokenKeys(c);
    const page = readPageParams(c.req.query("limit"), c.req.query("cursor"));
    const listed = await deps.storage.notes.listByUser(userId, page);
    return c.json({
      notes: await notesOut(keys, listed.notes),
      nextCursor: listed.nextCursor,
    });
  });

  notes.get("/:id", async (c) => {
    const { userId } = c.get("auth");
    const keys = tokenKeys(c);
    const id = c.req.param("id") as string;
    const sealed = await deps.storage.notes.getById(id, userId);
    const note = sealed && (await noteOut(keys, sealed));
    if (!note) {
      throw new HttpError(404, "Note not found");
    }
    return c.json({ note });
  });

  // The client chooses a new note's id, since everything it sealed is bound
  // to it, so an id can arrive that is already someone's.
  notes.post("/", async (c) => {
    const { userId } = c.get("auth");
    const keys = tokenKeys(c);
    const { id, imageRefs, previewRefs, ...fields } = await createBody(
      c,
      keys,
      deps.storage,
    );
    if (await deps.storage.notes.exists(id)) {
      throw new HttpError(409, "A note already has this id");
    }
    const now = nowIso();
    const note = await deps.storage.notes.insert({
      id,
      userId,
      data: {
        ...fields,
        imageRefs: await claimImages(deps.storage, imageRefs, userId),
        previewRefs: await claimImages(deps.storage, previewRefs, userId),
        trashedAt: fields.trashed ? now : null,
      },
      createdAt: now,
      updatedAt: now,
    });
    deps.noteEvents.created(note, userId);
    return c.json({ note: await noteOut(keys, note) }, 201);
  });

  // A backup, or part of one. A note keeps its id and creation time, so a
  // backup imported twice updates the same notes rather than duplicating them.
  notes.post("/import", async (c) => {
    const { userId } = c.get("auth");
    const keys = tokenKeys(c);
    const result: NotesImportResponse = {
      created: 0,
      updated: 0,
      skipped: 0,
    };
    const taken: string[] = [];
    const stale: string[] = [];
    for (const item of await importBody(c, keys, deps.storage)) {
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
      // A note already here stays under the key it has. A copy sealed under
      // any other (the key before a replacement, which someone taken off the
      // note still holds, or a new one made on a device that could not open
      // the note) is not stored: it would take the note back to that key and
      // leave its versions and everyone else's copy unable to open it.
      const { key, keyVersion, ...sealedFields } = fields;
      if (access) {
        const held = await deps.storage.notes.getById(id, userId);
        if (!held || held.key !== key || held.keyVersion !== keyVersion) {
          stale.push(id);
          continue;
        }
      }
      // A token's write over a note it already has names the references
      // only where it changed the list they describe.
      const data = {
        ...sealedFields,
        ...(imageRefs !== undefined && {
          imageRefs: await claimImages(deps.storage, imageRefs, userId),
        }),
        ...(previewRefs !== undefined && {
          previewRefs: await claimImages(deps.storage, previewRefs, userId),
        }),
      };
      if (access) {
        // Held to the key just checked, in the write itself.
        const written = await deps.storage.notes.update(
          id,
          userId,
          { ...data, ...trashStamp(fields.trashed, now) },
          now,
          undefined,
          keyVersion,
        );
        if (!written) {
          stale.push(id);
          continue;
        }
        await deps.noteEvents.changed(id, { trashChanged: true });
        result.updated++;
        continue;
      }
      const note = await deps.storage.notes.insert({
        id,
        userId,
        data: {
          ...data,
          key,
          keyVersion,
          imageRefs: await claimImages(deps.storage, imageRefs ?? [], userId),
          previewRefs: await claimImages(
            deps.storage,
            previewRefs ?? [],
            userId,
          ),
          trashedAt: fields.trashed ? now : null,
        },
        createdAt: createdAt ? new Date(createdAt).toISOString() : now,
        updatedAt: now,
      });
      deps.noteEvents.created(note, userId);
      result.created++;
    }
    if (taken.length > 0) result.taken = taken;
    if (stale.length > 0) result.stale = stale;
    return c.json(result);
  });

  notes.put("/:id", async (c) => {
    const { userId } = c.get("auth");
    const keys = tokenKeys(c);
    const id = c.req.param("id") as string;
    const fields = await updateBody(c, keys, deps.storage, id);
    if (!fields) throw new HttpError(404, "Note not found");
    const now = nowIso();
    const { imageRefs, previewRefs, keyVersion, ...rest } = fields;
    const changes: StoredNoteUpdate = {
      ...rest,
      ...trashStamp(fields.trashed, now),
      // A calendar feed's copy of the note key goes when the reminder does.
      ...(fields.reminder === null && { reminderKey: "" }),
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
        );
      }
      if (previewRefs !== undefined) {
        changes.previewRefs = await claimImages(
          deps.storage,
          previewRefs,
          access.ownerId,
        );
      }
    }
    const ifMatch = c.req.header("If-Match");
    // Atomic compare-and-set: storage.notes.update with an
    // `expectedUpdatedAt` only touches the row if its current
    // updated_at still matches. A null result means one of:
    //   (a) the note doesn't exist or this user cannot see it (404)
    //   (b) the note exists but updated_at moved on (412 + current note)
    //   (c) the words were sealed under a key the note has since left (409)
    // The key is part of the same statement: a check made before the write
    // would let a replacement in between the two, and what was then stored
    // nobody could open.
    let updated: Awaited<ReturnType<typeof deps.storage.notes.update>>;
    try {
      updated = await deps.storage.notes.update(
        id,
        userId,
        changes,
        now,
        ifMatch,
        keyVersion,
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
      // The app reads the note again and seals under the key it has now.
      if (keyVersion !== undefined && current.keyVersion !== keyVersion) {
        throw new HttpError(409, "The note is under another key now");
      }
      if (ifMatch !== undefined && current.updatedAt !== ifMatch) {
        // 412 carries the current note so the client can run a 3-way
        // merge and retry without re-fetching.
        return c.json(
          { error: "Note has changed", note: await noteOut(keys, current) },
          412,
        );
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
    return c.json({ note: await noteOut(keys, updated) });
  });

  /**
   * The note under a new key, which its owner's app makes when someone who
   * held the old one no longer holds the note. The server cannot tell a good
   * key from a bad one; what it holds to is that the whole note moves at
   * once, from the version it is at and from the note as the client read it
   * (`If-Match`, required: the fields come sealed again from that read, so a
   * write since then would be undone), and that everyone else's copy of the
   * key is then behind until a client that holds the new one wraps it for
   * them.
   */
  notes.put("/:id/key", async (c) => {
    const { userId } = c.get("auth");
    const id = c.req.param("id") as string;
    const { links, ...rekeyed } = await bodyOf(c, noteRekeySchema);
    const ifMatch = c.req.header("If-Match");
    if (ifMatch === undefined) {
      throw new HttpError(428, "If-Match is required to replace a note's key");
    }
    const current = await deps.storage.notes.getById(id, userId);
    if (!current || (current.sharing?.role ?? "owner") !== "owner") {
      throw new HttpError(404, "Note not found");
    }
    if (rekeyed.keyVersion !== current.keyVersion + 1) {
      throw new HttpError(409, "The note is under another key now");
    }
    const moved =
      current.updatedAt === ifMatch &&
      (await deps.storage.notes.rekey(
        id,
        userId,
        rekeyed,
        current.keyVersion,
        nowIso(),
        ifMatch,
      ));
    if (!moved) {
      // Written since the client read it, by anyone on the note: it reads
      // again and seals what is there now.
      return c.json({ error: "Note has changed" }, 412);
    }
    for (const link of links ?? []) {
      await deps.storage.publicLinks.rewrap(link.token, id, link.wrappedKey);
    }
    await deps.noteEvents.changed(id);
    const note = await deps.storage.notes.getById(id, userId);
    if (!note) throw new HttpError(404, "Note not found");
    return c.json({ note });
  });

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
