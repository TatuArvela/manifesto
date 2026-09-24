import type { ShareInvitation, ShareRole } from "@manifesto/shared";
import {
  type InvitationRow,
  rowToInvitation,
  rowToShare,
  type ShareRow,
} from "../shareMapping.js";
import type {
  CreateShareInput,
  NoteAudience,
  NoteShare,
  SharesRepo,
} from "../types.js";
import type { PgPool } from "./database.js";

/** See the SQLite copy: same queries, same reasons. */

const SHARE_COLUMNS = `note_id, user_id, role, created_at, accepted_at`;

const INVITATION_SELECT = `
  SELECT s.note_id, s.role, s.created_at, n.title, n.content, n.color, n.font,
         n.user_id AS owner_id, u.username, u.display_name, u.avatar_color
  FROM note_shares s
  JOIN notes n ON n.id = s.note_id
  JOIN users u ON u.id = n.user_id
  WHERE s.user_id = $1 AND s.accepted_at IS NULL AND n.trashed = FALSE`;

/** SQLSTATE 23505, as `usersRepo` reads it. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && (err as { code?: string }).code === "23505";
}

async function inTransaction<T>(
  pool: PgPool,
  run: (query: PgPool["query"]) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client.query.bind(client) as PgPool["query"]);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function createPostgresSharesRepo(pool: PgPool): SharesRepo {
  return {
    async audience(noteId: string): Promise<NoteAudience | null> {
      const note = await pool.query<{ user_id: string; trashed: boolean }>(
        `SELECT user_id, trashed FROM notes WHERE id = $1`,
        [noteId],
      );
      const row = note.rows[0];
      if (!row) return null;
      const shares = await pool.query<ShareRow>(
        `SELECT ${SHARE_COLUMNS} FROM note_shares WHERE note_id = $1
         ORDER BY created_at, user_id`,
        [noteId],
      );
      return {
        ownerId: row.user_id,
        trashed: row.trashed,
        shares: shares.rows.map(rowToShare),
      };
    },

    async create(input: CreateShareInput): Promise<"ok" | "exists"> {
      try {
        await pool.query(
          `INSERT INTO note_shares (note_id, user_id, role, created_at)
           VALUES ($1, $2, $3, $4)`,
          [input.noteId, input.userId, input.role, input.createdAt],
        );
        return "ok";
      } catch (err) {
        if (isUniqueViolation(err)) return "exists";
        throw err;
      }
    },

    async setRole(
      noteId: string,
      userId: string,
      role: ShareRole,
    ): Promise<boolean> {
      const result = await pool.query(
        `UPDATE note_shares SET role = $1 WHERE note_id = $2 AND user_id = $3`,
        [role, noteId, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async accept(
      noteId: string,
      userId: string,
      acceptedAt: string,
    ): Promise<boolean> {
      return inTransaction(pool, async (query) => {
        const note = await query<{ trashed: boolean; color: string }>(
          `SELECT trashed, color FROM notes WHERE id = $1 FOR UPDATE`,
          [noteId],
        );
        const row = note.rows[0];
        if (!row || row.trashed) return false;
        const result = await query(
          `UPDATE note_shares SET accepted_at = $1, color = $2, position = $3
           WHERE note_id = $4 AND user_id = $5 AND accepted_at IS NULL`,
          [acceptedAt, row.color, -Date.parse(acceptedAt), noteId, userId],
        );
        return (result.rowCount ?? 0) > 0;
      });
    },

    async delete(noteId: string, userId: string): Promise<NoteShare | null> {
      return inTransaction(pool, async (query) => {
        const found = await query<ShareRow>(
          `SELECT ${SHARE_COLUMNS} FROM note_shares
           WHERE note_id = $1 AND user_id = $2 FOR UPDATE`,
          [noteId, userId],
        );
        const row = found.rows[0];
        if (!row) return null;
        await query(
          `DELETE FROM note_shares WHERE note_id = $1 AND user_id = $2`,
          [noteId, userId],
        );
        return rowToShare(row);
      });
    },

    async listInvitations(userId: string): Promise<ShareInvitation[]> {
      const result = await pool.query<InvitationRow>(
        `${INVITATION_SELECT} ORDER BY s.created_at DESC, s.note_id DESC`,
        [userId],
      );
      return result.rows.map(rowToInvitation);
    },

    async getInvitation(
      noteId: string,
      userId: string,
    ): Promise<ShareInvitation | null> {
      const result = await pool.query<InvitationRow>(
        `${INVITATION_SELECT} AND s.note_id = $2`,
        [userId, noteId],
      );
      const row = result.rows[0];
      return row ? rowToInvitation(row) : null;
    },

    async listByRecipient(userId: string): Promise<NoteShare[]> {
      const result = await pool.query<ShareRow>(
        `SELECT ${SHARE_COLUMNS} FROM note_shares WHERE user_id = $1`,
        [userId],
      );
      return result.rows.map(rowToShare);
    },

    async listByOwner(ownerId: string): Promise<NoteShare[]> {
      const result = await pool.query<ShareRow>(
        `SELECT s.note_id, s.user_id, s.role, s.created_at, s.accepted_at
         FROM note_shares s JOIN notes n ON n.id = s.note_id
         WHERE n.user_id = $1`,
        [ownerId],
      );
      return result.rows.map(rowToShare);
    },
  };
}
