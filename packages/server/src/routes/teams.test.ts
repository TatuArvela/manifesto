import type {
  AdminTeamResponse,
  Note,
  NoteCreate,
  ShareInvitation,
  TeamsResponse,
} from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAccessChanges } from "../sharing/accessChanges.js";
import { createNoteEvents } from "../sharing/noteEvents.js";
import { createTeamShares } from "../sharing/teamShares.js";
import { syncOidcTeams } from "../sharing/teamSync.js";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

const baseNote: NoteCreate = {
  title: "Plan",
  content: "",
  color: NoteColor.Default,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 0,
  tags: [],
  images: [],
  linkPreviews: [],
  reminder: null,
};

type Account = { token: string; userId: string };

describe("teams as share targets", () => {
  let rig: TestRig;
  let admin: Account;
  let owner: Account;
  let alice: Account;
  let bob: Account;

  beforeEach(async () => {
    rig = await bootTestApp();
    admin = await registerTestUser(rig, "admin");
    owner = await registerTestUser(rig, "olivia");
    alice = await registerTestUser(rig, "alice");
    bob = await registerTestUser(rig, "bob");
  });

  afterEach(async () => {
    await rig.close();
  });

  function call(
    who: Account,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return rig.request(path, {
      method,
      headers: authHeaders(who.token),
      body: body === undefined ? null : JSON.stringify(body),
    });
  }

  async function makeTeam(name: string, members: Account[]): Promise<string> {
    const res = await call(admin, "POST", "/api/admin/teams", {
      name,
      memberIds: members.map((m) => m.userId),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as AdminTeamResponse).team.id;
  }

  async function createNote(): Promise<Note> {
    const res = await call(owner, "POST", "/api/notes", baseNote);
    return ((await res.json()) as { note: Note }).note;
  }

  async function shareWithTeam(noteId: string, teamId: string, role = "edit") {
    return call(owner, "POST", `/api/notes/${noteId}/team-shares`, {
      teamId,
      role,
    });
  }

  async function invitationsOf(who: Account): Promise<ShareInvitation[]> {
    const res = await call(who, "GET", "/api/invitations");
    return ((await res.json()) as { invitations: ShareInvitation[] })
      .invitations;
  }

  async function canRead(who: Account, noteId: string): Promise<boolean> {
    return (await call(who, "GET", `/api/notes/${noteId}`)).status === 200;
  }

  async function accept(who: Account, noteId: string) {
    const res = await call(who, "POST", `/api/invitations/${noteId}/accept`);
    expect(res.status).toBe(200);
  }

  it("lists a team to its members and to no one else", async () => {
    await makeTeam("Design", [owner, alice]);
    const mine = async (who: Account) =>
      (
        (await (await call(who, "GET", "/api/teams")).json()) as TeamsResponse
      ).teams.map((t) => t.name);
    expect(await mine(alice)).toEqual(["Design"]);
    expect(await mine(bob)).toEqual([]);
  });

  it("invites every member but the owner, naming the team", async () => {
    const team = await makeTeam("Design", [owner, alice, bob]);
    const note = await createNote();
    expect((await shareWithTeam(note.id, team)).status).toBe(201);

    for (const who of [alice, bob]) {
      const [invitation] = await invitationsOf(who);
      expect(invitation).toMatchObject({
        noteId: note.id,
        role: "edit",
        team: { id: team, name: "Design" },
      });
      expect(await canRead(who, note.id)).toBe(false);
    }
    expect(await invitationsOf(owner)).toEqual([]);

    await accept(alice, note.id);
    const read = await call(alice, "GET", `/api/notes/${note.id}`);
    const { note: aliceView } = (await read.json()) as { note: Note };
    expect(
      aliceView.sharing?.members.find((m) => m.id === alice.userId)?.team,
    ).toEqual({ id: team, name: "Design" });
  });

  it("lets only a member share with a team", async () => {
    const team = await makeTeam("Others", [alice]);
    const note = await createNote();
    expect((await shareWithTeam(note.id, team)).status).toBe(404);
  });

  it("changes the members' role with the team's, and takes the note back when unshared", async () => {
    const team = await makeTeam("Design", [owner, alice, bob]);
    const note = await createNote();
    await shareWithTeam(note.id, team);
    await accept(alice, note.id);

    const changed = await call(
      owner,
      "PUT",
      `/api/notes/${note.id}/team-shares/${team}`,
      { role: "view" },
    );
    expect(changed.status).toBe(200);
    const read = await call(alice, "GET", `/api/notes/${note.id}`);
    expect(((await read.json()) as { note: Note }).note.sharing?.role).toBe(
      "view",
    );
    expect((await invitationsOf(bob))[0]?.role).toBe("view");

    const removed = await call(
      owner,
      "DELETE",
      `/api/notes/${note.id}/team-shares/${team}`,
    );
    expect(removed.status).toBe(204);
    expect(await canRead(alice, note.id)).toBe(false);
    expect(await invitationsOf(bob)).toEqual([]);
  });

  it("leaves a direct share alone, and lets a direct invite take a share out of the team's hands", async () => {
    const team = await makeTeam("Design", [owner, alice, bob]);
    const note = await createNote();
    // Bob has it directly, before the team share.
    await call(owner, "POST", `/api/notes/${note.id}/shares`, {
      userId: bob.userId,
      role: "view",
    });
    await shareWithTeam(note.id, team, "edit");
    expect((await invitationsOf(bob))[0]?.role).toBe("view");

    // Alice had it through the team, and is then given it directly.
    const direct = await call(owner, "POST", `/api/notes/${note.id}/shares`, {
      userId: alice.userId,
      role: "edit",
    });
    expect(direct.status).toBe(201);

    await call(owner, "DELETE", `/api/notes/${note.id}/team-shares/${team}`);
    expect((await invitationsOf(alice))[0]?.noteId).toBe(note.id);
    expect((await invitationsOf(alice))[0]?.team).toBeUndefined();
    expect((await invitationsOf(bob))[0]?.noteId).toBe(note.id);
  });

  it("hands a share to another team the member is in when the first lets go", async () => {
    const first = await makeTeam("First", [owner, alice]);
    const second = await makeTeam("Second", [owner, alice]);
    const note = await createNote();
    await shareWithTeam(note.id, first, "edit");
    await shareWithTeam(note.id, second, "view");
    await accept(alice, note.id);

    await call(owner, "DELETE", `/api/notes/${note.id}/team-shares/${first}`);
    const read = await call(alice, "GET", `/api/notes/${note.id}`);
    expect(read.status).toBe(200);
    const { note: view } = (await read.json()) as { note: Note };
    expect(view.sharing?.role).toBe("view");
    expect(
      view.sharing?.members.find((m) => m.id === alice.userId)?.team?.id,
    ).toBe(second);
  });

  it("invites someone who joins later, and takes the note from someone who leaves", async () => {
    const team = await makeTeam("Design", [owner, alice]);
    const note = await createNote();
    await shareWithTeam(note.id, team);
    await accept(alice, note.id);

    const update = await call(admin, "PUT", `/api/admin/teams/${team}`, {
      memberIds: [owner.userId, bob.userId],
    });
    expect(update.status).toBe(200);
    expect((await invitationsOf(bob))[0]?.noteId).toBe(note.id);
    expect(await canRead(alice, note.id)).toBe(false);
  });

  it("invites someone who joined while the note was in the owner's trash once it is restored", async () => {
    const team = await makeTeam("Design", [owner]);
    const note = await createNote();
    await shareWithTeam(note.id, team);
    await call(owner, "PUT", `/api/notes/${note.id}`, { trashed: true });

    await call(admin, "PUT", `/api/admin/teams/${team}`, {
      memberIds: [owner.userId, alice.userId],
    });
    expect(await invitationsOf(alice)).toEqual([]);

    await call(owner, "PUT", `/api/notes/${note.id}`, { trashed: false });
    expect((await invitationsOf(alice))[0]?.noteId).toBe(note.id);
  });

  it("leaves nothing behind when a member it names does not exist", async () => {
    const missing = await call(admin, "POST", "/api/admin/teams", {
      name: "Design",
      memberIds: [alice.userId, "01J00000000000000000000000"],
    });
    expect(missing.status).toBe(404);
    const listed = await call(admin, "GET", "/api/admin/teams");
    expect(((await listed.json()) as { teams: unknown[] }).teams).toEqual([]);
    await makeTeam("Design", [alice]);
  });

  it("takes its notes with it when the team is removed", async () => {
    const team = await makeTeam("Design", [owner, alice]);
    const note = await createNote();
    await shareWithTeam(note.id, team);
    await accept(alice, note.id);
    expect(
      (await call(admin, "DELETE", `/api/admin/teams/${team}`)).status,
    ).toBe(204);
    expect(await canRead(alice, note.id)).toBe(false);
  });

  it("is managed by admins only", async () => {
    const res = await call(alice, "GET", "/api/admin/teams");
    expect(res.status).toBe(403);
    await makeTeam("Design", []);
    const clash = await call(admin, "POST", "/api/admin/teams", {
      name: "Design",
    });
    expect(clash.status).toBe(409);
  });

  describe("from the identity provider", () => {
    function service() {
      const accessChanges = createAccessChanges();
      const noteEvents = createNoteEvents({
        storage: rig.storage,
        broadcaster: rig.broadcaster,
        accessChanges,
      });
      return createTeamShares({
        storage: rig.storage,
        broadcaster: rig.broadcaster,
        noteEvents,
        accessChanges,
      });
    }

    it("mirrors the groups named at sign-in, and follows them", async () => {
      const teamShares = service();
      await syncOidcTeams(rig.storage, teamShares, owner.userId, ["eng"]);
      await syncOidcTeams(rig.storage, teamShares, alice.userId, [
        "eng",
        "ops",
      ]);
      const eng = await rig.storage.teams.findByName("oidc", "eng");
      expect(eng?.memberCount).toBe(2);

      const note = await createNote();
      await shareWithTeam(note.id, eng?.id as string);
      expect((await invitationsOf(alice))[0]?.noteId).toBe(note.id);

      // Out of the group at the provider: out of the team, and the note.
      await syncOidcTeams(rig.storage, teamShares, alice.userId, ["ops"]);
      expect(await invitationsOf(alice)).toEqual([]);
      expect(
        (await rig.storage.teams.listForUser(alice.userId)).map((t) => t.name),
      ).toEqual(["ops"]);
    });

    it("refuses an admin's edit of a team the provider owns", async () => {
      await syncOidcTeams(rig.storage, service(), alice.userId, ["eng"]);
      const eng = await rig.storage.teams.findByName("oidc", "eng");
      const res = await call(admin, "PUT", `/api/admin/teams/${eng?.id}`, {
        memberIds: [],
      });
      expect(res.status).toBe(409);
    });
  });
});
