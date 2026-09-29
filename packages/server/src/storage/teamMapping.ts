import type { TeamSource } from "@manifesto/shared";
import { parseRole } from "./shareMapping.js";
import type { NoteTeamShare, StoredTeam } from "./types.js";

/** A `teams` row with its member count, as both drivers read it. */
export interface TeamRow {
  id: string;
  name: string;
  source: string;
  created_at: string;
  member_count: number | string;
}

export interface NoteTeamShareRow {
  note_id: string;
  team_id: string;
  role: string;
  created_at: string;
}

/**
 * Selects teams with how many members each has: `${TEAM_SELECT} WHERE …
 * ${TEAM_GROUP} ORDER BY …`. A join and a group rather than a correlated
 * subquery, which pg-mem (the Postgres tests) cannot run.
 */
export const TEAM_SELECT = `SELECT t.id, t.name, t.source, t.created_at,
  COUNT(m.user_id) AS member_count
  FROM teams t LEFT JOIN team_members m ON m.team_id = t.id`;

export const TEAM_GROUP = "GROUP BY t.id, t.name, t.source, t.created_at";

export function rowToTeam(row: TeamRow): StoredTeam {
  return {
    id: row.id,
    name: row.name,
    source: (row.source === "oidc" ? "oidc" : "local") satisfies TeamSource,
    createdAt: row.created_at,
    memberCount: Number(row.member_count),
  };
}

export function rowToNoteTeamShare(row: NoteTeamShareRow): NoteTeamShare {
  return {
    noteId: row.note_id,
    teamId: row.team_id,
    role: parseRole(row.role),
    createdAt: row.created_at,
  };
}
