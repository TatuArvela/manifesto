import type { SyncResponse } from "@manifesto/shared";
import { Hono } from "hono";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import { readPageParams } from "../validation/pageParams.js";

interface SyncDeps {
  storage: StorageDriver;
}

/**
 * How far behind the moment of asking a checkpoint is placed.
 *
 * A write is stamped with the time its request started, not the time it was
 * committed, so a slow write can land after a sync that already handed out a
 * later checkpoint; a checkpoint at "now" would miss it for good. Setting the
 * checkpoint this far back makes every sync read the last two minutes again,
 * which costs a few repeated notes the client recognises as unchanged, and
 * covers any write that takes less than this to commit, an import included,
 * and a little clock skew between instances.
 */
export const SYNC_OVERLAP_MS = 2 * 60_000;

/**
 * The checkpoint is a time, but it is handed out opaque so that it can become
 * something else (a sequence, a per-session record) without clients noticing.
 * The prefix is its format.
 */
const CHECKPOINT_PREFIX = "t1:";

export function encodeCheckpoint(iso: string): string {
  return Buffer.from(`${CHECKPOINT_PREFIX}${iso}`, "utf8").toString(
    "base64url",
  );
}

/** Null for anything that is not a checkpoint this server wrote. */
export function decodeCheckpoint(raw: string): string | null {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  if (!text.startsWith(CHECKPOINT_PREFIX)) return null;
  const iso = text.slice(CHECKPOINT_PREFIX.length);
  const time = Date.parse(iso);
  if (Number.isNaN(time) || new Date(time).toISOString() !== iso) return null;
  return iso;
}

/**
 * A page cursor of this route carries the checkpoint the last page will hand
 * out, fixed when the first page was asked for. Taken again at the last page,
 * it would skip whatever changed while the client was paging.
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
 * `GET /api/sync`: what changed since a checkpoint, so a client coming back
 * online reads what it missed rather than every note it has.
 *
 * Deletions are not recorded anywhere. The last page lists every id the user
 * can see instead, and the client drops what it holds that is not there: a
 * note deleted, emptied from the trash, or taken away by its owner. That
 * cannot drift the way a log of removals can, where one forgotten writer
 * leaves a note on a device forever.
 */
export function createSyncRoutes(deps: SyncDeps) {
  const sync = new Hono<{ Variables: { auth: AuthContext } }>();

  sync.get("/", async (c) => {
    const { userId } = c.get("auth");

    const rawSince = c.req.query("since");
    // No checkpoint means everything: the empty string sorts before every
    // timestamp, and before no null.
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
      notes,
      nextCursor: last ? null : encodeSyncCursor(next, nextCursor),
      ids: last ? await deps.storage.notes.visibleIds(userId) : null,
      checkpoint: last ? next : null,
    } satisfies SyncResponse);
  });

  return sync;
}
