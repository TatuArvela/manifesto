import { zValidator } from "@hono/zod-validator";
import type {
  AdminTeam,
  AdminTeamResponse,
  AdminTeamsResponse,
  ShareUser,
  Team,
  TeamShare,
  TeamSharesResponse,
  TeamsResponse,
} from "@manifesto/shared";
import { type Context, Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import { nowIso } from "#/lib/time.ts";
import { newId } from "#/lib/ulid.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { TeamShares } from "#/sharing/teamShares.ts";
import type { StorageDriver, StoredTeam } from "#/storage/types.ts";
import {
  adminTeamCreateSchema,
  adminTeamUpdateSchema,
  shareUpdateSchema,
  teamShareCreateSchema,
} from "#/validation/sharingSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";

type AuthedApp = Hono<{ Variables: { auth: AuthContext } }>;

interface TeamDeps {
  storage: StorageDriver;
  teamShares: TeamShares;
}

function toTeam(team: StoredTeam): Team {
  return {
    id: team.id,
    name: team.name,
    source: team.source,
    memberCount: team.memberCount,
  };
}

/** `GET /api/v1/teams`: the teams of the signed-in user, for a share. */
export function createTeamRoutes(deps: { storage: StorageDriver }) {
  const routes: AuthedApp = new Hono();

  routes.get("/", async (c) => {
    const teams = await deps.storage.teams.listForUser(c.get("auth").userId);
    return c.json({ teams: teams.map(toTeam) } satisfies TeamsResponse);
  });

  return routes;
}

/**
 * `/api/v1/notes/:id/team-shares`: the teams with which a note is shared,
 * managed by its owner. The owner can share only with a team that they are in.
 * `sharing/teamShares.ts` tells what that does for each member.
 */
export function registerTeamShareRoutes(notes: AuthedApp, deps: TeamDeps) {
  const { storage, teamShares } = deps;

  async function requireOwner(c: Context, noteId: string): Promise<string> {
    const { userId } = c.get("auth") as AuthContext;
    const access = await storage.notes.access(noteId, userId);
    if (!access) throw new HttpError(404, "Note not found");
    if (access.role !== "owner") {
      throw new HttpError(403, "Only the owner can change who has this note");
    }
    return userId;
  }

  async function listOf(noteId: string): Promise<TeamSharesResponse> {
    const teamShares: TeamShare[] = [];
    for (const share of await storage.teams.sharesOfNote(noteId)) {
      const team = await storage.teams.get(share.teamId);
      if (team) {
        teamShares.push({ teamId: team.id, name: team.name, role: share.role });
      }
    }
    return { teamShares };
  }

  notes.get("/:id/team-shares", async (c) => {
    const noteId = c.req.param("id") as string;
    await requireOwner(c, noteId);
    return c.json(await listOf(noteId));
  });

  notes.post(
    "/:id/team-shares",
    zValidator("json", teamShareCreateSchema, validatorHook),
    async (c) => {
      const noteId = c.req.param("id") as string;
      const userId = await requireOwner(c, noteId);
      const { teamId, role } = c.req.valid("json");
      const note = await storage.notes.getById(noteId, userId);
      if (!note) throw new HttpError(404, "Note not found");
      if (note.trashed) {
        throw new HttpError(409, "A note in the trash cannot be shared");
      }
      if (note.readonly) {
        throw new HttpError(422, "Automatic notes cannot be shared");
      }
      // Only your own teams. You cannot see or fill the teams of other persons.
      const members = await storage.teams.members(teamId);
      if (!members.includes(userId)) {
        throw new HttpError(404, "Team not found");
      }
      const shared = await teamShares.share(noteId, userId, teamId, role);
      if (shared === "exists") {
        throw new HttpError(409, "The note is already shared with this team");
      }
      if (shared === "gone") throw new HttpError(404, "Team not found");
      audit(storage, c, {
        action: "share.team_added",
        actorId: userId,
        noteId,
        detail: { team: teamId, role },
      });
      return c.json(await listOf(noteId), 201);
    },
  );

  notes.put(
    "/:id/team-shares/:teamId",
    zValidator("json", shareUpdateSchema, validatorHook),
    async (c) => {
      const noteId = c.req.param("id") as string;
      const teamId = c.req.param("teamId") as string;
      const userId = await requireOwner(c, noteId);
      const { role } = c.req.valid("json");
      if (!(await teamShares.setRole(noteId, teamId, role))) {
        throw new HttpError(404, "Team share not found");
      }
      audit(storage, c, {
        action: "share.team_role_changed",
        actorId: userId,
        noteId,
        detail: { team: teamId, to: role },
      });
      return c.json(await listOf(noteId));
    },
  );

  notes.delete("/:id/team-shares/:teamId", async (c) => {
    const noteId = c.req.param("id") as string;
    const teamId = c.req.param("teamId") as string;
    const userId = await requireOwner(c, noteId);
    if (!(await teamShares.unshare(noteId, teamId))) {
      throw new HttpError(404, "Team share not found");
    }
    audit(storage, c, {
      action: "share.team_removed",
      actorId: userId,
      noteId,
      detail: { team: teamId },
    });
    return c.body(null, 204);
  });
}

/**
 * `/api/v1/admin/teams`: all teams, which an admin makes, renames, fills and
 * removes. The identity provider owns the members of an `oidc` team. You cannot
 * set them here. You can rename it only there. Thus, also not here. Registered
 * on the admin router, behind its session-only admin check.
 */
export function registerAdminTeamRoutes(admin: AuthedApp, deps: TeamDeps) {
  const { storage, teamShares } = deps;

  async function adminTeam(team: StoredTeam): Promise<AdminTeam> {
    const members: ShareUser[] = [];
    for (const id of await storage.teams.members(team.id)) {
      const user = await storage.users.findById(id);
      if (user) {
        members.push({
          id: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
          avatarColor: user.avatarColor,
        });
      }
    }
    return { ...toTeam(team), members, createdAt: team.createdAt };
  }

  async function found(id: string): Promise<StoredTeam> {
    const team = await storage.teams.get(id);
    if (!team) throw new HttpError(404, "Team not found");
    return team;
  }

  /**
   * Refuses a member list that names a person who does not exist. Called before
   * anything is written. Thus, a refused request leaves no team or name behind.
   */
  async function checkMembers(wanted: string[]): Promise<void> {
    for (const id of new Set(wanted)) {
      if (!(await storage.users.findById(id))) {
        throw new HttpError(404, "User not found");
      }
    }
  }

  /**
   * Makes the members of a team the same as `wanted`, through joined/left. Each
   * change is its own audit entry, written when it is made. To join a team is
   * an invitation to each note shared with it. Thus, the record must show who
   * was put in which team, and a run that fails halfway recorded what it did.
   */
  async function setMembers(
    c: Context,
    teamId: string,
    wanted: string[],
  ): Promise<void> {
    const { userId: actorId } = c.get("auth") as AuthContext;
    const want = new Set(wanted);
    const current = new Set(await storage.teams.members(teamId));
    for (const id of want) {
      if (current.has(id)) continue;
      if (await storage.teams.addMember(teamId, id)) {
        audit(storage, c, {
          action: "admin.team_member_added",
          actorId,
          targetId: id,
          detail: { team: teamId },
        });
        await teamShares.joined(teamId, id);
      }
    }
    for (const id of current) {
      if (want.has(id)) continue;
      if (await storage.teams.removeMember(teamId, id)) {
        audit(storage, c, {
          action: "admin.team_member_removed",
          actorId,
          targetId: id,
          detail: { team: teamId },
        });
        await teamShares.left(teamId, id);
      }
    }
  }

  admin.get("/teams", async (c) => {
    const teams: AdminTeam[] = [];
    for (const team of await storage.teams.list()) {
      teams.push(await adminTeam(team));
    }
    return c.json({ teams } satisfies AdminTeamsResponse);
  });

  admin.post(
    "/teams",
    zValidator("json", adminTeamCreateSchema, validatorHook),
    async (c) => {
      const { name, memberIds } = c.req.valid("json");
      if (memberIds) await checkMembers(memberIds);
      const id = newId();
      const created = await storage.teams.create({
        id,
        name,
        source: "local",
        createdAt: nowIso(),
      });
      if (created === "exists") {
        throw new HttpError(409, "A team by that name already exists");
      }
      audit(storage, c, {
        action: "admin.team_created",
        actorId: c.get("auth").userId,
        detail: { team: id, name },
      });
      if (memberIds) await setMembers(c, id, memberIds);
      return c.json(
        { team: await adminTeam(await found(id)) } satisfies AdminTeamResponse,
        201,
      );
    },
  );

  admin.put(
    "/teams/:id",
    zValidator("json", adminTeamUpdateSchema, validatorHook),
    async (c) => {
      const team = await found(c.req.param("id") as string);
      const { name, memberIds } = c.req.valid("json");
      if (team.source === "oidc") {
        throw new HttpError(
          409,
          "This team follows a group at the identity provider",
        );
      }
      if (memberIds) await checkMembers(memberIds);
      if (name !== undefined && name !== team.name) {
        const renamed = await storage.teams.rename(team.id, name);
        if (renamed === "exists") {
          throw new HttpError(409, "A team by that name already exists");
        }
        // A rename, with both names. People share with a team by its name.
        audit(storage, c, {
          action: "admin.team_updated",
          actorId: c.get("auth").userId,
          detail: { team: team.id, name, was: team.name },
        });
      }
      if (memberIds) await setMembers(c, team.id, memberIds);
      return c.json({
        team: await adminTeam(await found(team.id)),
      } satisfies AdminTeamResponse);
    },
  );

  admin.delete("/teams/:id", async (c) => {
    const team = await found(c.req.param("id") as string);
    // Its members lose what came through it before it goes. The notes go to a
    // different team that they share, if there is one.
    await teamShares.dissolve(team.id);
    await storage.teams.delete(team.id);
    // A note shared with it, or a member put in it, while it was in removal.
    await teamShares.settle(team.id);
    audit(storage, c, {
      action: "admin.team_deleted",
      actorId: c.get("auth").userId,
      detail: { team: team.id, name: team.name },
    });
    return c.body(null, 204);
  });
}
