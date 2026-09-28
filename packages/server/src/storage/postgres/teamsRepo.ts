import {
  type NoteTeamShareRow,
  rowToNoteTeamShare,
  rowToTeam,
  TEAM_GROUP,
  TEAM_SELECT,
  type TeamRow,
} from "../teamMapping.js";
import type { TeamsRepo } from "../types.js";
import type { PgPool } from "./database.js";

/** SQLSTATE 23505, as `usersRepo` reads it. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && (err as { code?: string }).code === "23505";
}

/** See the SQLite copy: the same statements. */
export function createPostgresTeamsRepo(pool: PgPool): TeamsRepo {
  const teams = async (sql: string, params: unknown[]) =>
    (await pool.query<TeamRow>(sql, params)).rows.map(rowToTeam);
  const shares = async (sql: string, params: unknown[]) =>
    (await pool.query<NoteTeamShareRow>(sql, params)).rows.map(
      rowToNoteTeamShare,
    );
  const changed = async (sql: string, params: unknown[]) =>
    ((await pool.query(sql, params)).rowCount ?? 0) > 0;

  return {
    async create(team) {
      try {
        await pool.query(
          `INSERT INTO teams (id, name, source, created_at)
           VALUES ($1, $2, $3, $4)`,
          [team.id, team.name, team.source, team.createdAt],
        );
        return "ok";
      } catch (err) {
        if (isUniqueViolation(err)) return "exists";
        throw err;
      }
    },
    async get(id) {
      return (
        (
          await teams(`${TEAM_SELECT} WHERE t.id = $1 ${TEAM_GROUP}`, [id])
        )[0] ?? null
      );
    },
    async findByName(source, name) {
      return (
        (
          await teams(
            `${TEAM_SELECT} WHERE t.source = $1 AND t.name = $2 ${TEAM_GROUP}`,
            [source, name],
          )
        )[0] ?? null
      );
    },
    async list() {
      return teams(`${TEAM_SELECT} ${TEAM_GROUP} ORDER BY t.name, t.id`, []);
    },
    async listForUser(userId) {
      return teams(
        `${TEAM_SELECT} WHERE t.id IN
           (SELECT team_id FROM team_members WHERE user_id = $1)
         ${TEAM_GROUP} ORDER BY t.name, t.id`,
        [userId],
      );
    },
    async rename(id, name) {
      try {
        return (await changed(`UPDATE teams SET name = $1 WHERE id = $2`, [
          name,
          id,
        ]))
          ? "ok"
          : "missing";
      } catch (err) {
        if (isUniqueViolation(err)) return "exists";
        throw err;
      }
    },
    async delete(id) {
      return changed(`DELETE FROM teams WHERE id = $1`, [id]);
    },
    async members(teamId) {
      const result = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY user_id`,
        [teamId],
      );
      return result.rows.map((row) => row.user_id);
    },
    async addMember(teamId, userId) {
      return changed(
        `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [teamId, userId],
      );
    },
    async removeMember(teamId, userId) {
      return changed(
        `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
        [teamId, userId],
      );
    },
    async shareNote(share) {
      return changed(
        `INSERT INTO note_team_shares (note_id, team_id, role, created_at)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [share.noteId, share.teamId, share.role, share.createdAt],
      );
    },
    async setNoteRole(noteId, teamId, role) {
      return changed(
        `UPDATE note_team_shares SET role = $1 WHERE note_id = $2 AND team_id = $3`,
        [role, noteId, teamId],
      );
    },
    async unshareNote(noteId, teamId) {
      return changed(
        `DELETE FROM note_team_shares WHERE note_id = $1 AND team_id = $2`,
        [noteId, teamId],
      );
    },
    async sharesOfNote(noteId) {
      return shares(
        `SELECT * FROM note_team_shares WHERE note_id = $1
         ORDER BY created_at, team_id`,
        [noteId],
      );
    },
    async notesOf(teamId) {
      return shares(
        `SELECT * FROM note_team_shares WHERE team_id = $1 ORDER BY note_id`,
        [teamId],
      );
    },
  };
}
