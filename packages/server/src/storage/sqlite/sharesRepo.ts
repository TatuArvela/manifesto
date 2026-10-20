import type { ShareInvitation, ShareRole } from "@manifesto/shared";
import {
  heldKey,
  type InvitationRow,
  membersChangedAt,
  rowToInvitation,
  rowToShare,
  type ShareRow,
} from "#/storage/shareMapping.ts";
import type {
  CreateShareInput,
  HeldKey,
  NoteAudience,
  NoteShare,
  SharesRepo,
} from "#/storage/types.ts";
import type { SqliteDB } from "./database.ts";

const SHARE_COLUMNS = `note_id, user_id, role, created_at, accepted_at, via_team,
  offered_key, wrapped_key_version`;

const INVITATION_SELECT = `
  SELECT s.note_id, s.role, s.created_at, n.title, n.content, n.font,
         n.key_version, s.offered_key,
         n.user_id AS owner_id, u.username, u.display_name, u.avatar_color,
         s.via_team, t.name AS team_name
  FROM note_shares s
  JOIN notes n ON n.id = s.note_id
  JOIN users u ON u.id = n.user_id
  LEFT JOIN teams t ON t.id = s.via_team
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
    `INSERT INTO note_shares
       (note_id, user_id, role, created_at, via_team, offered_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const offerStmt = db.prepare(
    `UPDATE note_shares SET offered_key = ? WHERE note_id = ? AND user_id = ?`,
  );
  const holdStmt = db.prepare(
    `UPDATE note_shares
     SET wrapped_key = ?, wrapped_key_version = ?, offered_key = NULL
     WHERE note_id = ? AND user_id = ? AND accepted_at IS NOT NULL`,
  );
  const setViaTeamStmt = db.prepare(
    `UPDATE note_shares SET via_team = ? WHERE note_id = ? AND user_id = ?`,
  );
  const setRoleStmt = db.prepare(
    `UPDATE note_shares SET role = ? WHERE note_id = ? AND user_id = ?`,
  );
  const acceptStmt = db.prepare(
    `UPDATE note_shares
     SET accepted_at = ?, position = ?, wrapped_key = ?,
         wrapped_key_version = ?, offered_key = NULL
     WHERE note_id = ? AND user_id = ? AND accepted_at IS NULL`,
  );
  const deleteStmt = db.prepare(
    `DELETE FROM note_shares WHERE note_id = ? AND user_id = ?`,
  );
  const membersChangedStmt = db.prepare(
    `UPDATE notes SET members_changed_at = ? WHERE id = ?`,
  );
  const invitationsStmt = db.prepare(
    `${INVITATION_SELECT} ORDER BY s.created_at DESC, s.note_id DESC`,
  );
  const invitationStmt = db.prepare(`${INVITATION_SELECT} AND s.note_id = ?`);
  const byRecipientStmt = db.prepare(
    `SELECT ${SHARE_COLUMNS} FROM note_shares WHERE user_id = ?`,
  );
  const byOwnerStmt = db.prepare(
    `SELECT s.note_id, s.user_id, s.role, s.created_at, s.accepted_at, s.via_team,
            s.offered_key, s.wrapped_key_version
     FROM note_shares s JOIN notes n ON n.id = s.note_id
     WHERE n.user_id = ?`,
  );
  const byTeamStmt = db.prepare(
    `SELECT ${SHARE_COLUMNS} FROM note_shares WHERE via_team = ?
     ORDER BY note_id, user_id`,
  );

  const acceptTx = db.transaction(
    (
      noteId: string,
      userId: string,
      acceptedAt: string,
      held: HeldKey,
    ): boolean => {
      const note = noteStmt.get(noteId) as
        | { trashed: number; color: string }
        | undefined;
      if (!note || note.trashed === 1) return false;
      // At the start of the manual order, as their own note would be.
      const info = acceptStmt.run(
        acceptedAt,
        -Date.parse(acceptedAt),
        held.key,
        held.keyVersion,
        noteId,
        userId,
      );
      if (info.changes === 0) return false;
      membersChangedStmt.run(acceptedAt, noteId);
      return true;
    },
  );

  const rekeyDueStmt = db.prepare(
    `UPDATE notes SET rekey_due = 1 WHERE id = ?`,
  );
  const deleteTx = db.transaction(
    (noteId: string, userId: string): NoteShare | null => {
      const row = findStmt.get(noteId, userId) as ShareRow | undefined;
      if (!row) return null;
      deleteStmt.run(noteId, userId);
      membersChangedStmt.run(membersChangedAt(), noteId);
      if (heldKey(row)) rekeyDueStmt.run(noteId);
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
        insertStmt.run(
          input.noteId,
          input.userId,
          input.role,
          input.createdAt,
          input.viaTeam ?? null,
          input.offeredKey ? JSON.stringify(input.offeredKey) : null,
        );
        membersChangedStmt.run(input.createdAt, input.noteId);
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
      if (setRoleStmt.run(role, noteId, userId).changes === 0) return false;
      membersChangedStmt.run(membersChangedAt(), noteId);
      return true;
    },

    async setViaTeam(noteId, userId, teamId) {
      if (setViaTeamStmt.run(teamId, noteId, userId).changes === 0) {
        return false;
      }
      membersChangedStmt.run(membersChangedAt(), noteId);
      return true;
    },

    async accept(
      noteId: string,
      userId: string,
      acceptedAt: string,
      held: HeldKey,
    ): Promise<boolean> {
      return acceptTx.immediate(noteId, userId, acceptedAt, held);
    },

    async offerKey(noteId, userId, offered) {
      return offerStmt.run(JSON.stringify(offered), noteId, userId).changes > 0;
    },

    async holdKey(noteId, userId, held) {
      return (
        holdStmt.run(held.key, held.keyVersion, noteId, userId).changes > 0
      );
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

    async listByTeam(teamId: string): Promise<NoteShare[]> {
      return (byTeamStmt.all(teamId) as ShareRow[]).map(rowToShare);
    },
  };
}
