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
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { audit } from "../audit/audit.js";
import type { AuthProvider } from "../auth/types.js";
import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { TeamShares } from "../sharing/teamShares.js";
import type { StorageDriver, StoredTeam } from "../storage/types.js";
import {
  adminTeamCreateSchema,
  adminTeamUpdateSchema,
  shareUpdateSchema,
  teamShareCreateSchema,
} from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";

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

/** `GET /api/teams`: the teams the signed-in user is in, to share with. */
export function createTeamRoutes(deps: {
  storage: StorageDriver;
  authProvider: AuthProvider;
  rateLimit?: MiddlewareHandler;
}) {
  const routes: AuthedApp = new Hono();
  routes.use("*", createAuthMiddleware(deps.authProvider));
  if (deps.rateLimit) routes.use("*", deps.rateLimit);

  routes.get("/", async (c) => {
    const teams = await deps.storage.teams.listForUser(c.get("auth").userId);
    return c.json({ teams: teams.map(toTeam) } satisfies TeamsResponse);
  });

  return routes;
}

/**
 * `/api/notes/:id/team-shares`: the teams a note is shared with, managed by
 * its owner, who may share only with a team they are in. What that does for
 * each member is `sharing/teamShares.ts`.
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
      // Only your own teams: nobody else's are yours to see or to fill.
      const members = await storage.teams.members(teamId);
      if (!members.includes(userId)) {
        throw new HttpError(404, "Team not found");
      }
      if (!(await teamShares.share(noteId, userId, teamId, role))) {
        throw new HttpError(409, "The note is already shared with this team");
      }
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
 * `/api/admin/teams`: every team, made, renamed, filled and removed by an
 * admin. An `oidc` team's members are the identity provider's and cannot be
 * set here; it can be renamed only there, so not here either. Registered on
 * the admin router, behind its session-only admin check.
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

  /** Refuses a member list naming someone who does not exist. Called before
   * anything is written, so a refused request leaves no team or name behind. */
  async function checkMembers(wanted: string[]): Promise<void> {
    for (const id of new Set(wanted)) {
      if (!(await storage.users.findById(id))) {
        throw new HttpError(404, "User not found");
      }
    }
  }

  /** Brings a team's members to `wanted`, through joined/left. */
  async function setMembers(teamId: string, wanted: string[]): Promise<void> {
    const want = new Set(wanted);
    const current = new Set(await storage.teams.members(teamId));
    for (const id of want) {
      if (current.has(id)) continue;
      if (await storage.teams.addMember(teamId, id)) {
        await teamShares.joined(teamId, id);
      }
    }
    for (const id of current) {
      if (want.has(id)) continue;
      if (await storage.teams.removeMember(teamId, id)) {
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
      if (memberIds) await setMembers(id, memberIds);
      audit(storage, c, {
        action: "admin.team_created",
        actorId: c.get("auth").userId,
        detail: { team: id, name },
      });
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
      }
      if (memberIds) await setMembers(team.id, memberIds);
      audit(storage, c, {
        action: "admin.team_updated",
        actorId: c.get("auth").userId,
        detail: { team: team.id },
      });
      return c.json({
        team: await adminTeam(await found(team.id)),
      } satisfies AdminTeamResponse);
    },
  );

  admin.delete("/teams/:id", async (c) => {
    const team = await found(c.req.param("id") as string);
    // Its members lose what came through it before it goes, and the notes
    // pass to another team they share where there is one.
    await teamShares.dissolve(team.id);
    await storage.teams.delete(team.id);
    audit(storage, c, {
      action: "admin.team_deleted",
      actorId: c.get("auth").userId,
      detail: { team: team.id, name: team.name },
    });
    return c.body(null, 204);
  });
}
