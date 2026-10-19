import type { Note, SealedNote, SyncResponse } from "@manifesto/shared";
import { Hono } from "hono";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { readPageParams } from "#/validation/pageParams.ts";
import { notesOut, tokenKeys } from "./noteCodec.ts";

interface SyncDeps {
  storage: StorageDriver;
}

/**
 * How far before the time of the request a checkpoint is.
 *
 * A write gets the time when its request started, not the time when it
 * committed. Thus, a slow write can arrive after a sync that already gave out a
 * later checkpoint. A checkpoint at "now" would lose it permanently. When the
 * checkpoint is this far back, each sync reads the last two minutes again. That
 * costs some repeated notes, which the client sees as unchanged. It covers each
 * write that takes less than this to commit, also an import, and a little clock
 * skew between instances.
 */
export const SYNC_OVERLAP_MS = 2 * 60_000;

/**
 * The checkpoint is a time, but it goes out opaque. Thus, it can become
 * something different (a sequence, a record for each session) without a change
 * for clients. The prefix is its format.
 */
const CHECKPOINT_PREFIX = "t1:";

export function encodeCheckpoint(iso: string): string {
  return Buffer.from(`${CHECKPOINT_PREFIX}${iso}`, "utf8").toString(
    "base64url",
  );
}

/** Null for all values that are not a checkpoint that this server wrote. */
export function decodeCheckpoint(raw: string): string | null {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  if (!text.startsWith(CHECKPOINT_PREFIX)) return null;
  const iso = text.slice(CHECKPOINT_PREFIX.length);
  const time = Date.parse(iso);
  if (Number.isNaN(time) || new Date(time).toISOString() !== iso) return null;
  return iso;
}

/**
 * A page cursor of this route contains the checkpoint that the last page will
 * give out, set when the client asked for the first page. If the code took it
 * again at the last page, it would skip the changes that occurred while the
 * client paged.
 */
function encodeSyncCursor(next: string, pageCursor: string): string {
  return Buffer.from(`${next}\u0000${pageCursor}`, "utf8").toString(
    "base64url",
  );
}

function decodeSyncCursor(
  raw: string,
): { next: string; pageCursor: string } | null {
  const [next, pageCursor, ...rest] = Buffer.from(raw, "base64url")
    .toString("utf8")
    .split("\u0000");
  if (rest.length > 0 || !next || !pageCursor) return null;
  return decodeCheckpoint(next) === null ? null : { next, pageCursor };
}

/**
 * `GET /api/v1/sync`: the changes since a checkpoint. Thus, a client that comes
 * back online reads only what it missed, not all of its notes.
 *
 * The server records no deletions. In place of that, the last page lists all
 * ids that the user can see, and the client drops the notes that it has that
 * are not there: a deleted note, a note emptied from the trash, or a note that
 * its owner took away. That cannot become incorrect as a log of removals can,
 * where one writer that forgets leaves a note on a device forever.
 */
export function createSyncRoutes(deps: SyncDeps) {
  const sync = new Hono<{ Variables: { auth: AuthContext } }>();

  sync.get("/", async (c) => {
    const { userId } = c.get("auth");
    const keys = tokenKeys(c);

    const rawSince = c.req.query("since");
    // No checkpoint means all notes. The empty string sorts before all
    // timestamps, and before no null.
    const since =
      rawSince === undefined || rawSince === ""
        ? ""
        : decodeCheckpoint(rawSince);
    if (since === null) throw new HttpError(400, "Invalid checkpoint");

    const rawCursor = c.req.query("cursor");
    const resumed =
      rawCursor === undefined ? null : decodeSyncCursor(rawCursor);
    if (rawCursor !== undefined && resumed === null) {
      throw new HttpError(400, "Invalid cursor");
    }
    const next =
      resumed?.next ??
      encodeCheckpoint(new Date(Date.now() - SYNC_OVERLAP_MS).toISOString());

    const page = readPageParams(c.req.query("limit"), resumed?.pageCursor);
    const { notes, nextCursor } = await deps.storage.notes.listChanged(
      userId,
      since,
      page,
    );
    const last = nextCursor === null;
    return c.json({
      notes: await notesOut(keys, notes),
      nextCursor: last ? null : encodeSyncCursor(next, nextCursor),
      ids: last ? await deps.storage.notes.visibleIds(userId) : null,
      checkpoint: last ? next : null,
    } satisfies SyncResponse<SealedNote | Note>);
  });

  return sync;
}
