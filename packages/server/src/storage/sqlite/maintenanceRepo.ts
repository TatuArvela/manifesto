import {
  heldKey,
  membersChangedAt,
  rowToShare,
  type ShareRow,
} from "#/storage/shareMapping.ts";
import { composeStats } from "#/storage/statsMapping.ts";
import type {
  ExpiredTrashedNote,
  MaintenanceRepo,
  NoteShare,
} from "#/storage/types.ts";
import type { SqliteDB } from "./database.ts";

interface ExpiredRow {
  id: string;
  user_id: string;
}

export function createSqliteMaintenanceRepo(db: SqliteDB): MaintenanceRepo {
  // Atomic delete-and-return so a note un-trashed between SELECT and DELETE
  // can't be hard-deleted out from under the user. Requires SQLite ≥ 3.35.
  const cleanupStmt = db.prepare(
    `DELETE FROM notes
       WHERE trashed = 1
         AND trashed_at IS NOT NULL
         AND trashed_at < ?
     RETURNING id, user_id`,
  );

  const cleanupSharesStmt = db.prepare(
    `DELETE FROM note_shares
       WHERE trashed = 1
         AND trashed_at IS NOT NULL
         AND trashed_at < ?
     RETURNING note_id, user_id, role, created_at, accepted_at, via_team,
       offered_key, wrapped_key_version`,
  );

  const membersChangedStmt = db.prepare(
    `UPDATE notes SET members_changed_at = ? WHERE id = ?`,
  );
  const rekeyDueStmt = db.prepare(
    `UPDATE notes SET rekey_due = 1 WHERE id = ?`,
  );
  // An expired share leaves the note's members, as a removal does, and
  // leaves the note due a new key as one does (`shares.delete`): whoever
  // held the old one still does.
  const cleanupSharesTx = db.transaction((cutoffIso: string): ShareRow[] => {
    const rows = cleanupSharesStmt.all(cutoffIso) as ShareRow[];
    const at = membersChangedAt();
    for (const noteId of new Set(rows.map((row) => row.note_id))) {
      membersChangedStmt.run(at, noteId);
    }
    for (const noteId of new Set(
      rows.filter(heldKey).map((row) => row.note_id),
    )) {
      rekeyDueStmt.run(noteId);
    }
    return rows;
  });

  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

  return {
    async stats() {
      const userIds = (
        db.prepare(`SELECT id FROM users`).all() as { id: string }[]
      ).map((r) => r.id);
      return composeStats(
        userIds,
        db
          .prepare(
            `SELECT user_id AS key, COUNT(*) AS n FROM notes GROUP BY user_id`,
          )
          .all() as { key: string; n: number }[],
        db
          .prepare(
            `SELECT owner_id AS key, COUNT(*) AS n, SUM(size) AS bytes
             FROM attachments GROUP BY owner_id`,
          )
          .all() as { key: string; n: number; bytes: number }[],
        {
          trashedNotes: count(
            `SELECT COUNT(*) AS n FROM notes WHERE trashed = 1`,
          ),
          shares: count(`SELECT COUNT(*) AS n FROM note_shares`),
          versions: count(`SELECT COUNT(*) AS n FROM note_versions`),
        },
      );
    },

    async cleanupTrashedSharesBefore(cutoffIso: string): Promise<NoteShare[]> {
      return cleanupSharesTx.immediate(cutoffIso).map(rowToShare);
    },

    async cleanupTrashedBefore(
      cutoffIso: string,
    ): Promise<ExpiredTrashedNote[]> {
      const rows = cleanupStmt.all(cutoffIso) as ExpiredRow[];
      return rows.map((row) => ({ id: row.id, userId: row.user_id }));
    },
    async rewriteColumn(table, keys, column, rewrite) {
      const rows = db
        .prepare(
          `SELECT ${[...keys, column].join(", ")} FROM ${table}
           WHERE ${column} IS NOT NULL AND ${column} <> ''`,
        )
        .all() as Record<string, string>[];
      const update = db.prepare(
        `UPDATE ${table} SET ${column} = ?
         WHERE ${keys.map((key) => `${key} = ?`).join(" AND ")}
           AND ${column} = ?`,
      );
      let written = 0;
      for (const row of rows) {
        const stored = row[column];
        if (typeof stored !== "string") continue;
        const next = rewrite(stored);
        if (next === null) continue;
        // Only while the row still holds what was read.
        written += update.run(
          next,
          ...keys.map((key) => row[key]),
          stored,
        ).changes;
      }
      return written;
    },
  };
}
