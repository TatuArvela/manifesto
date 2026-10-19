import {
  DEFAULT_NOTES_PAGE_SIZE,
  MAX_NOTES_PAGE_SIZE,
} from "@manifesto/shared";
import { HttpError } from "#/middleware/error.ts";
import { decodeCursor } from "#/storage/noteMapping.ts";
import type { ListNotesOptions } from "#/storage/types.ts";

/**
 * `?limit=&cursor=` for the two list endpoints.
 *
 * The code clamps a limit outside the permitted range, and does not refuse it.
 * A caller that asks for more than one page wants as much as possible, and a
 * 400 teaches it nothing on which it can act. The code *does* refuse a
 * malformed cursor. If it silently started again from the top, a paging client
 * would get the first page again and again, and it would look like a server
 * with three notes on it.
 */
export function readPageParams(
  limit: string | undefined,
  cursor: string | undefined,
): ListNotesOptions {
  const asked = limit === undefined ? DEFAULT_NOTES_PAGE_SIZE : Number(limit);
  const bounded = Number.isFinite(asked)
    ? Math.min(Math.max(Math.trunc(asked), 1), MAX_NOTES_PAGE_SIZE)
    : DEFAULT_NOTES_PAGE_SIZE;
  if (cursor !== undefined && decodeCursor(cursor) === null) {
    throw new HttpError(400, "Invalid cursor");
  }
  return { limit: bounded, ...(cursor !== undefined && { cursor }) };
}
