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
import type { SqliteDB } from "./database.js";

const SHARE_COLUMNS = `note_id, user_id, role, created_at, accepted_at`;

const INVITATION_SELECT = `
  SELECT s.note_id, s.role, s.created_at, n.title, n.content, n.color, n.font,
         n.user_id AS owner_id, u.username, u.display_name, u.avatar_color
  FROM note_shares s
  JOIN notes n ON n.id = s.note_id
  JOIN users u ON u.id = n.user_id
  WHERE s.user_id = ? AND s.accepted_at IS NULL AND n.trashed = 0`;

function isPrimaryKeyViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as { code?: string }).code === "SQLITE_CONSTRAINT_PRIMARYKEY"
  );
}

export function createSqliteSharesRepo(db: SqliteDB): SharesRepo {
  const noteStmt = db.prepare(
    `SELECT user_id, trashed, color FROM notes WHERE id = ?`,
  );
  const sharesOfNoteStmt = db.prepare(
    `SELECT ${SHARE_COLUMNS} FROM note_shares WHERE note_id = ?
     ORDER BY created_at, user_id`,
  );
  const findStmt = db.prepare(
    `SELECT ${SHARE_COLUMNS} FROM note_shares WHERE note_id = ? AND user_id = ?`,
  );
  const insertStmt = db.prepare(
    `INSERT INTO note_shares (note_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)`,
  );
  const setRoleStmt = db.prepare(
    `UPDATE note_shares SET role = ? WHERE note_id = ? AND user_id = ?`,
  );
  const acceptStmt = db.prepare(
    `UPDATE note_shares SET accepted_at = ?, color = ?, position = ?
     WHERE note_id = ? AND user_id = ? AND accepted_at IS NULL`,
  );
  const deleteStmt = db.prepare(
    `DELETE FROM note_shares WHERE note_id = ? AND user_id = ?`,
  );
  const invitationsStmt = db.prepare(
    `${INVITATION_SELECT} ORDER BY s.created_at DESC, s.note_id DESC`,
  );
  const invitationStmt = db.prepare(`${INVITATION_SELECT} AND s.note_id = ?`);
  const byRecipientStmt = db.prepare(
    `SELECT ${SHARE_COLUMNS} FROM note_shares WHERE user_id = ?`,
  );
  const byOwnerStmt = db.prepare(
    `SELECT s.note_id, s.user_id, s.role, s.created_at, s.accepted_at
     FROM note_shares s JOIN notes n ON n.id = s.note_id
     WHERE n.user_id = ?`,
  );

  const acceptTx = db.transaction(
    (noteId: string, userId: string, acceptedAt: string): boolean => {
      const note = noteStmt.get(noteId) as
        | { trashed: number; color: string }
        | undefined;
      if (!note || note.trashed === 1) return false;
      // At the head of the manual order, as a note of their own would be.
      const info = acceptStmt.run(
        acceptedAt,
        note.color,
        -Date.parse(acceptedAt),
        noteId,
        userId,
      );
      return info.changes > 0;
    },
  );

  const deleteTx = db.transaction(
    (noteId: string, userId: string): NoteShare | null => {
      const row = findStmt.get(noteId, userId) as ShareRow | undefined;
      if (!row) return null;
      deleteStmt.run(noteId, userId);
      return rowToShare(row);
    },
  );

  return {
    async audience(noteId: string): Promise<NoteAudience | null> {
      const note = noteStmt.get(noteId) as
        | { user_id: string; trashed: number }
        | undefined;
      if (!note) return null;
      const rows = sharesOfNoteStmt.all(noteId) as ShareRow[];
      return {
        ownerId: note.user_id,
        trashed: note.trashed === 1,
        shares: rows.map(rowToShare),
      };
    },

    async create(input: CreateShareInput): Promise<"ok" | "exists"> {
      try {
        insertStmt.run(input.noteId, input.userId, input.role, input.createdAt);
        return "ok";
      } catch (err) {
        if (isPrimaryKeyViolation(err)) return "exists";
        throw err;
      }
    },

    async setRole(
      noteId: string,
      userId: string,
      role: ShareRole,
    ): Promise<boolean> {
      return setRoleStmt.run(role, noteId, userId).changes > 0;
    },

    async accept(
      noteId: string,
      userId: string,
      acceptedAt: string,
    ): Promise<boolean> {
      return acceptTx.immediate(noteId, userId, acceptedAt);
    },

    async delete(noteId: string, userId: string): Promise<NoteShare | null> {
      return deleteTx.immediate(noteId, userId);
    },

    async listInvitations(userId: string): Promise<ShareInvitation[]> {
      return (invitationsStmt.all(userId) as InvitationRow[]).map(
        rowToInvitation,
      );
    },

    async getInvitation(
      noteId: string,
      userId: string,
    ): Promise<ShareInvitation | null> {
      const row = invitationStmt.get(userId, noteId) as
        | InvitationRow
        | undefined;
      return row ? rowToInvitation(row) : null;
    },

    async listByRecipient(userId: string): Promise<NoteShare[]> {
      return (byRecipientStmt.all(userId) as ShareRow[]).map(rowToShare);
    },

    async listByOwner(ownerId: string): Promise<NoteShare[]> {
      return (byOwnerStmt.all(ownerId) as ShareRow[]).map(rowToShare);
    },
  };
}
