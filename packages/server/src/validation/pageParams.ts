import {
  DEFAULT_NOTES_PAGE_SIZE,
  MAX_NOTES_PAGE_SIZE,
} from "@manifesto/shared";
import { HttpError } from "../middleware/error.js";
import { decodeCursor } from "../storage/noteMapping.js";
import type { ListNotesOptions } from "../storage/types.js";

/**
 * `?limit=&cursor=` for the two list endpoints.
 *
 * A limit outside the allowed range is clamped rather than refused: a caller
 * asking for more than a page holds wants as much as it can get, and a 400
 * teaches it nothing it can act on. A malformed cursor *is* refused, because
 * quietly restarting from the top would hand a paging client the first page
 * over and over and look like a server with three notes on it.
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
