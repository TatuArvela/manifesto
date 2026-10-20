import { nowIso } from "#/lib/time.ts";
import { newId } from "#/lib/ulid.ts";
import type { StorageDriver } from "#/storage/types.ts";
import type { TeamShares } from "./teamShares.ts";

/**
 * Puts a user in exactly the teams of the identity provider that it just named
 * for them: the teams of those groups, made when first seen. It removes the
 * user from all other `oidc` teams. It does not change teams that an admin made
 * (`local`). Joins and leaves go through `teamShares`. Thus, they bring and
 * take away the notes of the teams.
 */
export async function syncOidcTeams(
  storage: StorageDriver,
  teamShares: TeamShares,
  userId: string,
  groups: string[],
): Promise<void> {
  const wanted = new Set<string>();
  for (const name of new Set(groups)) {
    let team = await storage.teams.findByName("oidc", name);
    if (!team) {
      // Two sign-ins try to make it at the same time. The one that loses reads
      // the team of the winner.
      await storage.teams.create({
        id: newId(),
        name,
        source: "oidc",
        createdAt: nowIso(),
      });
      team = await storage.teams.findByName("oidc", name);
    }
    if (!team) continue;
    wanted.add(team.id);
    if (await storage.teams.addMember(team.id, userId)) {
      await teamShares.joined(team.id, userId);
    }
  }
  for (const team of await storage.teams.listForUser(userId)) {
    if (team.source !== "oidc" || wanted.has(team.id)) continue;
    if (await storage.teams.removeMember(team.id, userId)) {
      await teamShares.left(team.id, userId);
    }
  }
}
