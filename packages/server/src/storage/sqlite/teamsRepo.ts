import {
  type NoteTeamShareRow,
  rowToNoteTeamShare,
  rowToTeam,
  TEAM_GROUP,
  TEAM_SELECT,
  type TeamRow,
} from "../teamMapping.js";
import type { TeamsRepo } from "../types.js";
import type { SqliteDB } from "./database.js";

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    String((err as { code: unknown }).code).startsWith("SQLITE_CONSTRAINT")
  );
}

export function createSqliteTeamsRepo(db: SqliteDB): TeamsRepo {
  const insertStmt = db.prepare(
    `INSERT INTO teams (id, name, source, created_at)
     VALUES (@id, @name, @source, @createdAt)`,
  );
  const getStmt = db.prepare(`${TEAM_SELECT} WHERE t.id = ? ${TEAM_GROUP}`);
  const byNameStmt = db.prepare(
    `${TEAM_SELECT} WHERE t.source = ? AND t.name = ? ${TEAM_GROUP}`,
  );
  const listStmt = db.prepare(
    `${TEAM_SELECT} ${TEAM_GROUP} ORDER BY t.name, t.id`,
  );
  const forUserStmt = db.prepare(
    `${TEAM_SELECT} WHERE t.id IN
       (SELECT team_id FROM team_members WHERE user_id = ?)
     ${TEAM_GROUP} ORDER BY t.name, t.id`,
  );
  const renameStmt = db.prepare(`UPDATE teams SET name = ? WHERE id = ?`);
  const deleteStmt = db.prepare(`DELETE FROM teams WHERE id = ?`);
  const membersStmt = db.prepare(
    `SELECT user_id FROM team_members WHERE team_id = ? ORDER BY user_id`,
  );
  const addMemberStmt = db.prepare(
    `INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)`,
  );
  const removeMemberStmt = db.prepare(
    `DELETE FROM team_members WHERE team_id = ? AND user_id = ?`,
  );
  const shareStmt = db.prepare(
    `INSERT OR IGNORE INTO note_team_shares (note_id, team_id, role, created_at)
     VALUES (@noteId, @teamId, @role, @createdAt)`,
  );
  const setRoleStmt = db.prepare(
    `UPDATE note_team_shares SET role = ? WHERE note_id = ? AND team_id = ?`,
  );
  const unshareStmt = db.prepare(
    `DELETE FROM note_team_shares WHERE note_id = ? AND team_id = ?`,
  );
  const ofNoteStmt = db.prepare(
    `SELECT * FROM note_team_shares WHERE note_id = ?
     ORDER BY created_at, team_id`,
  );
  const ofTeamStmt = db.prepare(
    `SELECT * FROM note_team_shares WHERE team_id = ? ORDER BY note_id`,
  );

  return {
    async create(team) {
      try {
        insertStmt.run(team);
        return "ok";
      } catch (err) {
        if (isUniqueViolation(err)) return "exists";
        throw err;
      }
    },
    async get(id) {
      const row = getStmt.get(id) as TeamRow | undefined;
      return row ? rowToTeam(row) : null;
    },
    async findByName(source, name) {
      const row = byNameStmt.get(source, name) as TeamRow | undefined;
      return row ? rowToTeam(row) : null;
    },
    async list() {
      return (listStmt.all() as TeamRow[]).map(rowToTeam);
    },
    async listForUser(userId) {
      return (forUserStmt.all(userId) as TeamRow[]).map(rowToTeam);
    },
    async rename(id, name) {
      try {
        return renameStmt.run(name, id).changes > 0 ? "ok" : "missing";
      } catch (err) {
        if (isUniqueViolation(err)) return "exists";
        throw err;
      }
    },
    async delete(id) {
      return deleteStmt.run(id).changes > 0;
    },
    async members(teamId) {
      return (membersStmt.all(teamId) as { user_id: string }[]).map(
        (row) => row.user_id,
      );
    },
    async addMember(teamId, userId) {
      return addMemberStmt.run(teamId, userId).changes > 0;
    },
    async removeMember(teamId, userId) {
      return removeMemberStmt.run(teamId, userId).changes > 0;
    },
    async shareNote(share) {
      return shareStmt.run(share).changes > 0;
    },
    async setNoteRole(noteId, teamId, role) {
      return setRoleStmt.run(role, noteId, teamId).changes > 0;
    },
    async unshareNote(noteId, teamId) {
      return unshareStmt.run(noteId, teamId).changes > 0;
    },
    async sharesOfNote(noteId) {
      return (ofNoteStmt.all(noteId) as NoteTeamShareRow[]).map(
        rowToNoteTeamShare,
      );
    },
    async notesOf(teamId) {
      return (ofTeamStmt.all(teamId) as NoteTeamShareRow[]).map(
        rowToNoteTeamShare,
      );
    },
  };
}
