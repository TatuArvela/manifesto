import type { ServerStats } from "./types.js";

interface CountRow {
  key: string;
  n: number | string;
  bytes?: number | string | null;
}

/**
 * Assembles the overview from the same five aggregates in either driver: the
 * user ids, notes per owner, attachments and their bytes per owner, and the
 * three plain counts. Counts come back as strings from Postgres.
 */
export function composeStats(
  userIds: string[],
  notesByOwner: CountRow[],
  attachmentsByOwner: CountRow[],
  counts: { trashedNotes: number; shares: number; versions: number },
): ServerStats {
  const notes = new Map(notesByOwner.map((r) => [r.key, Number(r.n)]));
  const attachments = new Map(
    attachmentsByOwner.map((r) => [
      r.key,
      { n: Number(r.n), bytes: Number(r.bytes ?? 0) },
    ]),
  );
  const perUser = userIds
    .map((userId) => ({
      userId,
      notes: notes.get(userId) ?? 0,
      attachments: attachments.get(userId)?.n ?? 0,
      attachmentBytes: attachments.get(userId)?.bytes ?? 0,
    }))
    .sort(
      (a, b) =>
        b.attachmentBytes - a.attachmentBytes ||
        b.notes - a.notes ||
        a.userId.localeCompare(b.userId),
    );
  const sum = (key: "notes" | "attachments" | "attachmentBytes") =>
    perUser.reduce((total, row) => total + row[key], 0);
  return {
    totals: {
      users: userIds.length,
      notes: sum("notes"),
      attachments: sum("attachments"),
      attachmentBytes: sum("attachmentBytes"),
      ...counts,
    },
    perUser,
  };
}
