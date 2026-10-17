import {
  MAX_NOTES_PAGE_SIZE,
  type Note,
  type NotesResponse,
  openSealedNote,
} from "@manifesto/shared";
import { Hono } from "hono";
import type { AuthContext } from "#/middleware/authBearer.js";
import { HttpError } from "#/middleware/error.js";
import { encodeCursor } from "#/storage/noteMapping.js";
import type { StorageDriver } from "#/storage/types.js";
import { readPageParams } from "#/validation/pageParams.js";
import { tokenKeys } from "./noteCodec.js";

/**
 * `/api/search`. The server cannot read a note, so it cannot search one: the
 * app searches the notes it has opened, in memory, and its session is
 * refused here. A token that carries keys is answered by doing the same on
 * the server for the length of the request: the account's notes are opened
 * in memory and those whose title or text holds the query, whatever its
 * case, are returned newest first. Nothing opened is kept.
 */
export function createSearchRoutes(deps: { storage: StorageDriver }) {
  const search = new Hono<{ Variables: { auth: AuthContext } }>();

  search.get("/", async (c) => {
    const { userId } = c.get("auth");
    const keys = tokenKeys(c);
    if (!keys) throw new HttpError(403, "The app searches its own notes");
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const { limit, cursor } = readPageParams(
      c.req.query("limit"),
      c.req.query("cursor"),
    );
    if (q.length === 0) {
      return c.json({ notes: [], nextCursor: null } satisfies NotesResponse);
    }
    const found: Note[] = [];
    let more = false;
    // Where the page before left off: a result's cursor is the listing's
    // own, so the scan starts there and reads nothing it has answered.
    let next: string | undefined = cursor;
    scan: do {
      const page = await deps.storage.notes.listByUser(userId, {
        limit: MAX_NOTES_PAGE_SIZE,
        ...(next !== undefined && { cursor: next }),
      });
      for (const sealed of page.notes) {
        const note = (await openSealedNote(keys, sealed))?.note;
        if (
          !note ||
          !(
            note.title.toLowerCase().includes(q) ||
            note.content.toLowerCase().includes(q)
          )
        ) {
          continue;
        }
        if (found.length === limit) {
          more = true;
          break scan;
        }
        found.push(note);
      }
      next = page.nextCursor ?? undefined;
    } while (next !== undefined);
    const last = found.at(-1);
    return c.json({
      notes: found,
      nextCursor:
        more && last
          ? encodeCursor({ updatedAt: last.updatedAt, id: last.id })
          : null,
    } satisfies NotesResponse);
  });

  return search;
}
