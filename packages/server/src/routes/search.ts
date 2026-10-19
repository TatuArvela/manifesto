import {
  MAX_NOTES_PAGE_SIZE,
  type Note,
  type NotesResponse,
  openSealedNote,
} from "@manifesto/shared";
import { Hono } from "hono";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import { encodeCursor } from "#/storage/noteMapping.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { readPageParams } from "#/validation/pageParams.ts";
import { tokenKeys } from "./noteCodec.ts";

/**
 * `/api/v1/search`. The server cannot read a note. Thus, it cannot search one.
 * The app searches the notes that it opened, in memory, and the server refuses
 * its session here. A token that carries keys gets an answer: the server does
 * the same for the duration of the request. It opens the notes of the account
 * in memory, and returns the notes whose title or text contains the query,
 * whatever its case, newest first. It keeps nothing that it opened.
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
    // Where the previous page stopped. The cursor of a result is that of the
    // listing. Thus, the scan starts there, and reads nothing that it already
    // answered.
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
