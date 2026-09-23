import { rowToShare, type ShareRow } from "../shareMapping.js";
import { composeStats } from "../statsMapping.js";
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
  const count = async (sql: string) =>
    Number((await pool.query<{ n: number | string }>(sql)).rows[0]?.n ?? 0);

  return {
    async stats() {
      const users = await pool.query<{ id: string }>(`SELECT id FROM users`);
      const notes = await pool.query<{ key: string; n: string }>(
        `SELECT user_id AS key, COUNT(*) AS n FROM notes GROUP BY user_id`,
      );
      const attachments = await pool.query<{
        key: string;
        n: string;
        bytes: string | null;
      }>(
        `SELECT owner_id AS key, COUNT(*) AS n, SUM(size) AS bytes
         FROM attachments GROUP BY owner_id`,
      );
      return composeStats(
        users.rows.map((r) => r.id),
        notes.rows,
        attachments.rows,
        {
          trashedNotes: await count(
            `SELECT COUNT(*) AS n FROM notes WHERE trashed = TRUE`,
          ),
          shares: await count(`SELECT COUNT(*) AS n FROM note_shares`),
          versions: await count(`SELECT COUNT(*) AS n FROM note_versions`),
        },
      );
    },

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
