import type { ShareRole, ShareUser } from "../note.js";

/**
 * Where a team's members come from: `local` teams are made and filled by an
 * admin; `oidc` teams mirror a group at the identity provider, and their
 * members change only when someone signs in.
 */
export const TEAM_SOURCES = ["local", "oidc"] as const;
export type TeamSource = (typeof TEAM_SOURCES)[number];

/** A team as one of its members sees it. */
export interface Team {
  id: string;
  name: string;
  source: TeamSource;
  memberCount: number;
}

/** A team as the admin view shows it, members and all. */
export interface AdminTeam extends Team {
  members: ShareUser[];
  createdAt: string;
}

export interface TeamsResponse {
  teams: Team[];
}

export interface AdminTeamsResponse {
  teams: AdminTeam[];
}

export interface AdminTeamResponse {
  team: AdminTeam;
}

export interface AdminTeamCreateRequest {
  name: string;
  memberIds?: string[];
}

/** Members only for a `local` team; an `oidc` team's are the provider's. */
export interface AdminTeamUpdateRequest {
  name?: string;
  memberIds?: string[];
}

/** A note shared with a team, as its owner sees it. */
export interface TeamShare {
  teamId: string;
  name: string;
  role: ShareRole;
}

export interface TeamSharesResponse {
  teamShares: TeamShare[];
}

export interface TeamShareCreateRequest {
  teamId: string;
  role: ShareRole;
}
