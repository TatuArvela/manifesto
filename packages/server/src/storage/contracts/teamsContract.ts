import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StorageDriver } from "../types.js";
import { claimedImages, claimedPreviews } from "./claimed.js";

/**
 * Teams, the same in both drivers: names unique within a source, members
 * counted, and the rows that say which notes a team has and which of a
 * user's shares came through it.
 */

const T0 = "2026-04-01T00:00:00.000Z";

export function describeTeamsContract(
  name: string,
  boot: () => Promise<StorageDriver>,
): void {
  describe(`${name}: teams`, () => {
    let storage: StorageDriver;

    beforeEach(async () => {
      storage = await boot();
      for (const id of ["owner", "alice", "bob"]) {
        await storage.users.create({
          id,
          username: id,
          passwordHash: "h",
          displayName: "",
          avatarColor: "#123456",
          provider: "local",
          externalId: null,
          createdAt: T0,
        });
      }
      await storage.notes.insert({
        id: "n1",
        userId: "owner",
        data: {
          title: "",
          content: "",
          color: "default" as never,
          font: "default" as never,
          pinned: false,
          archived: false,
          trashed: false,
          trashedAt: null,
          position: 0,
          tags: [],
          images: claimedImages([]),
          linkPreviews: claimedPreviews([]),
          reminder: null,
        },
        createdAt: T0,
        updatedAt: T0,
      });
    });

    afterEach(async () => {
      await storage.close();
    });

    const team = (id: string, name: string, source: "local" | "oidc") =>
      storage.teams.create({ id, name, source, createdAt: T0 });

    it("keeps names unique within a source, and counts members", async () => {
      expect(await team("t1", "Design", "local")).toBe("ok");
      expect(await team("t2", "Design", "local")).toBe("exists");
      expect(await team("t3", "Design", "oidc")).toBe("ok");

      expect(await storage.teams.addMember("t1", "alice")).toBe(true);
      expect(await storage.teams.addMember("t1", "alice")).toBe(false);
      await storage.teams.addMember("t1", "bob");
      expect(await storage.teams.get("t1")).toMatchObject({
        name: "Design",
        source: "local",
        memberCount: 2,
      });
      expect(await storage.teams.members("t1")).toEqual(["alice", "bob"]);
      expect(
        (await storage.teams.listForUser("alice")).map((t) => t.id),
      ).toEqual(["t1"]);
      expect(await storage.teams.findByName("oidc", "Design")).toMatchObject({
        id: "t3",
      });

      expect(await storage.teams.rename("t3", "Design")).toBe("ok");
      await team("t4", "Other", "oidc");
      expect(await storage.teams.rename("t4", "Design")).toBe("exists");
      expect(await storage.teams.rename("nope", "X")).toBe("missing");

      expect(await storage.teams.removeMember("t1", "alice")).toBe(true);
      expect(await storage.teams.removeMember("t1", "alice")).toBe(false);
    });

    it("records a note's teams and a share's team", async () => {
      await team("t1", "Design", "local");
      const share = { noteId: "n1", teamId: "t1", role: "edit" as const };
      expect(await storage.teams.shareNote({ ...share, createdAt: T0 })).toBe(
        true,
      );
      expect(await storage.teams.shareNote({ ...share, createdAt: T0 })).toBe(
        false,
      );
      expect(await storage.teams.setNoteRole("n1", "t1", "view")).toBe(true);
      expect(await storage.teams.sharesOfNote("n1")).toEqual([
        { ...share, role: "view", createdAt: T0 },
      ]);
      expect(await storage.teams.notesOf("t1")).toHaveLength(1);

      await storage.shares.create({
        noteId: "n1",
        userId: "alice",
        role: "view",
        createdAt: T0,
        viaTeam: "t1",
      });
      const [invitation] = await storage.shares.listInvitations("alice");
      expect(invitation?.team).toEqual({ id: "t1", name: "Design" });
      expect(await storage.shares.setViaTeam("n1", "alice", null)).toBe(true);
      const audience = await storage.shares.audience("n1");
      expect(audience?.shares[0]?.viaTeam).toBeNull();

      expect(await storage.teams.unshareNote("n1", "t1")).toBe(true);
      expect(await storage.teams.sharesOfNote("n1")).toEqual([]);
    });

    it("goes with its members and notes when deleted", async () => {
      await team("t1", "Design", "local");
      await storage.teams.addMember("t1", "alice");
      await storage.teams.shareNote({
        noteId: "n1",
        teamId: "t1",
        role: "edit",
        createdAt: T0,
      });
      expect(await storage.teams.delete("t1")).toBe(true);
      expect(await storage.teams.listForUser("alice")).toEqual([]);
      expect(await storage.teams.sharesOfNote("n1")).toEqual([]);
    });
  });
}
