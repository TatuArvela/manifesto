import type { ExpiredTrashedNote, MaintenanceRepo } from "../types.js";
import type { PgPool } from "./database.js";

interface ExpiredRow {
  id: string;
  user_id: string;
}

export function createPostgresMaintenanceRepo(pool: PgPool): MaintenanceRepo {
  return {
    async cleanupTrashedBefore(
      cutoffIso: string,
    ): Promise<ExpiredTrashedNote[]> {
      const result = await pool.query<ExpiredRow>(
        `DELETE FROM notes
           WHERE trashed = TRUE
             AND trashed_at IS NOT NULL
             AND trashed_at < $1
         RETURNING id, user_id`,
        [cutoffIso],
      );
      return result.rows.map((row) => ({ id: row.id, userId: row.user_id }));
    },
  };
}
