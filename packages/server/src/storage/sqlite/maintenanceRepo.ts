import type { ExpiredTrashedNote, MaintenanceRepo } from "../types.js";
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

  return {
    async cleanupTrashedBefore(
      cutoffIso: string,
    ): Promise<ExpiredTrashedNote[]> {
      const rows = cleanupStmt.all(cutoffIso) as ExpiredRow[];
      return rows.map((row) => ({ id: row.id, userId: row.user_id }));
    },
  };
}
