import type {
  AdminTeam,
  AdminTeamResponse,
  AdminTeamsResponse,
  ShareRole,
  Team,
  TeamShare,
  TeamSharesResponse,
  TeamsResponse,
} from "@manifesto/shared";
import { apiFetch } from "#/storage/apiRequest.ts";

/**
 * Teams: the own teams of the signed-in user, with which to share a note, and
 * all teams for an admin to manage. A share with a team invites its members,
 * and the server keeps that correct while people join and leave. As the
 * remaining sharing code does, each call resolves with what occurred, and never
 * rejects.
 */

export async function listMyTeams(): Promise<Team[] | null> {
  const res = await apiFetch("GET", "/teams");
  if (!res?.ok) return null;
  return ((await res.json()) as TeamsResponse).teams;
}

export async function listTeamShares(
  noteId: string,
): Promise<TeamShare[] | null> {
  const res = await apiFetch("GET", `/notes/${noteId}/team-shares`);
  if (!res?.ok) return null;
  return ((await res.json()) as TeamSharesResponse).teamShares;
}

export async function shareWithTeam(
  noteId: string,
  teamId: string,
  role: ShareRole,
): Promise<TeamShare[] | null> {
  const res = await apiFetch("POST", `/notes/${noteId}/team-shares`, {
    teamId,
    role,
  });
  if (!res?.ok) return null;
  return ((await res.json()) as TeamSharesResponse).teamShares;
}

export async function setTeamShareRole(
  noteId: string,
  teamId: string,
  role: ShareRole,
): Promise<TeamShare[] | null> {
  const res = await apiFetch("PUT", `/notes/${noteId}/team-shares/${teamId}`, {
    role,
  });
  if (!res?.ok) return null;
  return ((await res.json()) as TeamSharesResponse).teamShares;
}

export async function removeTeamShare(
  noteId: string,
  teamId: string,
): Promise<boolean> {
  const res = await apiFetch(
    "DELETE",
    `/notes/${noteId}/team-shares/${teamId}`,
  );
  return res?.ok ?? false;
}

export async function listAdminTeams(): Promise<AdminTeam[] | null> {
  const res = await apiFetch("GET", "/admin/teams");
  if (!res?.ok) return null;
  return ((await res.json()) as AdminTeamsResponse).teams;
}

export type TeamWriteResult =
  | { kind: "ok"; team: AdminTeam }
  | { kind: "name-taken" | "failed" };

async function teamWrite(res: Response | null): Promise<TeamWriteResult> {
  if (res?.status === 409) return { kind: "name-taken" };
  if (!res?.ok) return { kind: "failed" };
  return { kind: "ok", team: ((await res.json()) as AdminTeamResponse).team };
}

export async function createTeam(
  name: string,
  memberIds: string[],
): Promise<TeamWriteResult> {
  return teamWrite(await apiFetch("POST", "/admin/teams", { name, memberIds }));
}

export async function updateTeam(
  id: string,
  changes: { name?: string; memberIds?: string[] },
): Promise<TeamWriteResult> {
  return teamWrite(await apiFetch("PUT", `/admin/teams/${id}`, changes));
}

export async function deleteTeam(id: string): Promise<boolean> {
  const res = await apiFetch("DELETE", `/admin/teams/${id}`);
  return res?.ok ?? false;
}
