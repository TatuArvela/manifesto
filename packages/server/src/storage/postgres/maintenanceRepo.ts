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
import type { PgPool } from "./database.ts";
import { inTransaction } from "./sharesRepo.ts";

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
      return inTransaction(pool, async (query) => {
        const result = await query<ShareRow>(
          `DELETE FROM note_shares
             WHERE trashed = TRUE
               AND trashed_at IS NOT NULL
               AND trashed_at < $1
           RETURNING note_id, user_id, role, created_at, accepted_at, via_team,
             offered_key, wrapped_key_version`,
          [cutoffIso],
        );
        // An expired share leaves the note's members, as a removal does,
        // and leaves the note due a new key as one does (`shares.delete`):
        // whoever held the old one still does.
        const at = membersChangedAt();
        for (const noteId of new Set(result.rows.map((row) => row.note_id))) {
          await query(
            `UPDATE notes SET members_changed_at = $1 WHERE id = $2`,
            [at, noteId],
          );
        }
        for (const noteId of new Set(
          result.rows.filter(heldKey).map((row) => row.note_id),
        )) {
          await query(`UPDATE notes SET rekey_due = 1 WHERE id = $1`, [noteId]);
        }
        return result.rows.map(rowToShare);
      });
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
    async rewriteColumn(table, keys, column, rewrite) {
      const found = await pool.query<Record<string, string>>(
        `SELECT ${[...keys, column].join(", ")} FROM ${table}
         WHERE ${column} IS NOT NULL AND ${column} <> ''`,
      );
      let written = 0;
      for (const row of found.rows) {
        const stored = row[column];
        if (typeof stored !== "string") continue;
        const next = rewrite(stored);
        if (next === null) continue;
        const where = keys.map((key, i) => `${key} = $${i + 2}`).join(" AND ");
        // Only while the row still holds what was read.
        const result = await pool.query(
          `UPDATE ${table} SET ${column} = $1
           WHERE ${where} AND ${column} = $${keys.length + 2}`,
          [next, ...keys.map((key) => row[key]), stored],
        );
        written += result.rowCount ?? 0;
      }
      return written;
    },
  };
}
