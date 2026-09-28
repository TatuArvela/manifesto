import { nowIso } from "../lib/time.js";
import { newId } from "../lib/ulid.js";
import type { StorageDriver } from "../storage/types.js";
import type { TeamShares } from "./teamShares.js";

/**
 * Puts a user in exactly the identity provider's teams it just named for
 * them: those groups' teams, made when first seen, and out of every other
 * `oidc` team. Admin-made (`local`) teams are left alone. Joining and leaving
 * go through `teamShares`, so they bring and take away the teams' notes.
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
      // Two sign-ins racing to make it: whichever loses reads the winner's.
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
