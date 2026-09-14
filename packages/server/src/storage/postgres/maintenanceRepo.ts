import { rowToShare, type ShareRow } from "../shareMapping.js";
import type {
  ExpiredTrashedNote,
  MaintenanceRepo,
  NoteShare,
} from "../types.js";
import type { PgPool } from "./database.js";

interface ExpiredRow {
  id: string;
  user_id: string;
}

export function createPostgresMaintenanceRepo(pool: PgPool): MaintenanceRepo {
  return {
    async cleanupTrashedSharesBefore(cutoffIso: string): Promise<NoteShare[]> {
      const result = await pool.query<ShareRow>(
        `DELETE FROM note_shares
           WHERE trashed = TRUE
             AND trashed_at IS NOT NULL
             AND trashed_at < $1
         RETURNING note_id, user_id, role, created_at, accepted_at`,
        [cutoffIso],
      );
      return result.rows.map(rowToShare);
    },

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
