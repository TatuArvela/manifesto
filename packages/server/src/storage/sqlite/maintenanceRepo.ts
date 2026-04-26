import type { ExpiredTrashedNote, MaintenanceRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

interface ExpiredRow {
  id: string;
  user_id: string;
}

export function createSqliteMaintenanceRepo(db: SqliteDB): MaintenanceRepo {
  const findExpiredStmt = db.prepare(
    `SELECT id, user_id FROM notes
       WHERE trashed = 1
         AND trashed_at IS NOT NULL
         AND trashed_at < ?`,
  );
  const deleteOneStmt = db.prepare(`DELETE FROM notes WHERE id = ?`);

  return {
    async cleanupTrashedBefore(
      cutoffIso: string,
    ): Promise<ExpiredTrashedNote[]> {
      const rows = findExpiredStmt.all(cutoffIso) as ExpiredRow[];
      if (rows.length === 0) return [];
      const tx = db.transaction((batch: ExpiredRow[]) => {
        for (const row of batch) deleteOneStmt.run(row.id);
      });
      tx(rows);
      return rows.map((row) => ({ id: row.id, userId: row.user_id }));
    },
  };
}
