import { rowToShare, type ShareRow } from "../shareMapping.js";
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

  return {
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
