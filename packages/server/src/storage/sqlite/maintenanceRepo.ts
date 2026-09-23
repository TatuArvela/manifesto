import { rowToShare, type ShareRow } from "../shareMapping.js";
import { composeStats } from "../statsMapping.js";
import type {
  ExpiredTrashedNote,
  MaintenanceRepo,
  NoteShare,
} from "../types.js";
import type { SqliteDB } from "./database.js";

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
     RETURNING note_id, user_id, role, created_at, accepted_at`,
  );

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
      return (cleanupSharesStmt.all(cutoffIso) as ShareRow[]).map(rowToShare);
    },

    async cleanupTrashedBefore(
      cutoffIso: string,
    ): Promise<ExpiredTrashedNote[]> {
      const rows = cleanupStmt.all(cutoffIso) as ExpiredRow[];
      return rows.map((row) => ({ id: row.id, userId: row.user_id }));
    },
  };
}
