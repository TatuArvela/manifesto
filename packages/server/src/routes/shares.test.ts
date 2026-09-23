import type {
  AdminTemporaryPasswordResponse,
  AdminUserResponse,
  AuthMeResponse,
  InvitationsResponse,
  Note,
  NoteCreate,
  UserLookupResponse,
  WebSocketEvent,
} from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

const baseNote: NoteCreate = {
  title: "Groceries",
  content: "- [ ] Milk",
  color: NoteColor.Yellow,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 0,
  tags: ["home"],
  images: [],
  linkPreviews: [],
  reminder: null,
};

interface Account {
  token: string;
  userId: string;
}

describe("sharing notes between accounts", () => {
  let rig: TestRig;
  let owner: Account;
  let alice: Account;
  let bob: Account;
  let events: { userId: string; event: WebSocketEvent }[];

  beforeEach(async () => {
    rig = await bootTestApp();
    owner = await registerTestUser(rig, "olivia");
    alice = await registerTestUser(rig, "alice");
    bob = await registerTestUser(rig, "bob");
    events = [];
    rig.broadcaster.subscribe((userId, event) =>
      events.push({ userId, event }),
    );
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
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function createNote(overrides: Partial<NoteCreate> = {}) {
    const res = await call(owner, "POST", "/api/notes", {
      ...baseNote,
      ...overrides,
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { note: Note }).note;
  }

  async function invite(noteId: string, who: Account, role = "edit") {
    return call(owner, "POST", `/api/notes/${noteId}/shares`, {
      userId: who.userId,
      role,
    });
  }

  async function shareAccepted(noteId: string, who: Account, role = "edit") {
    expect((await invite(noteId, who, role)).status).toBe(201);
    const res = await call(who, "POST", `/api/invitations/${noteId}/accept`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { note: Note }).note;
  }

  async function noteAs(who: Account, id: string): Promise<Response> {
    return call(who, "GET", `/api/notes/${id}`);
  }

  function eventsFor(userId: string) {
    return events.filter((e) => e.userId === userId).map((e) => e.event);
  }

  it("invites, and the note arrives only once the invitation is accepted", async () => {
    const note = await createNote();
    const res = await invite(note.id, alice);
    expect(res.status).toBe(201);
    const { note: ownerView } = (await res.json()) as { note: Note };
    expect(ownerView.sharing).toMatchObject({
      role: "owner",
      members: [{ id: alice.userId, role: "edit", accepted: false }],
    });
    expect(eventsFor(alice.userId)).toContainEqual(
      expect.objectContaining({ type: "invitation:created" }),
    );

    expect((await noteAs(alice, note.id)).status).toBe(404);
    const invitations = (await (
      await call(alice, "GET", "/api/invitations")
    ).json()) as InvitationsResponse;
    expect(invitations.invitations).toMatchObject([
      {
        noteId: note.id,
        role: "edit",
        title: "Groceries",
        owner: { username: "olivia" },
      },
    ]);

    const accepted = await call(
      alice,
      "POST",
      `/api/invitations/${note.id}/accept`,
    );
    expect(accepted.status).toBe(200);
    const { note: aliceView } = (await accepted.json()) as { note: Note };
    expect(aliceView).toMatchObject({
      title: "Groceries",
      tags: [],
      sharing: { role: "edit", owner: { id: owner.userId } },
    });
    const listed = (await (await call(alice, "GET", "/api/notes")).json()) as {
      notes: Note[];
    };
    expect(listed.notes.map((n) => n.id)).toEqual([note.id]);
    // The owner hears that the invitation was taken up.
    expect(eventsFor(owner.userId).at(-1)).toMatchObject({
      type: "note:updated",
      note: { sharing: { members: [{ accepted: true }] } },
    });
    expect(
      (await call(alice, "POST", `/api/invitations/${note.id}/accept`)).status,
    ).toBe(404);
  });

  it("lets only the owner decide who has the note", async () => {
    const note = await createNote();
    await shareAccepted(note.id, alice);

    const byRecipient = await call(
      alice,
      "POST",
      `/api/notes/${note.id}/shares`,
      {
        userId: bob.userId,
        role: "view",
      },
    );
    expect(byRecipient.status).toBe(403);
    expect(
      (
        await call(
          alice,
          "PUT",
          `/api/notes/${note.id}/shares/${alice.userId}`,
          {
            role: "edit",
          },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(bob, "POST", `/api/notes/${note.id}/shares`, {
          userId: bob.userId,
          role: "edit",
        })
      ).status,
    ).toBe(404);
  });

  it("refuses shares that make no sense", async () => {
    const note = await createNote();
    expect(
      (
        await call(owner, "POST", `/api/notes/${note.id}/shares`, {
          userId: owner.userId,
          role: "edit",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call(owner, "POST", `/api/notes/${note.id}/shares`, {
          userId: "01NOBODY000000000000000000",
          role: "edit",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(owner, "POST", `/api/notes/${note.id}/shares`, {
          userId: alice.userId,
          role: "admin",
        })
      ).status,
    ).toBe(422);
    expect((await invite(note.id, alice)).status).toBe(201);
    expect((await invite(note.id, alice)).status).toBe(409);

    const trashed = await createNote({ trashed: true });
    expect((await invite(trashed.id, alice)).status).toBe(409);
    const automatic = await createNote({ readonly: true });
    expect((await invite(automatic.id, alice)).status).toBe(422);
  });

  it("gives each person their own color, pin and tags, and everyone the text", async () => {
    const note = await createNote();
    await shareAccepted(note.id, alice);

    const res = await call(alice, "PUT", `/api/notes/${note.id}`, {
      title: "Shopping",
      tags: ["errands"],
      color: NoteColor.Blue,
      pinned: true,
    });
    expect(res.status).toBe(200);

    const ownerView = (
      (await (await noteAs(owner, note.id)).json()) as {
        note: Note;
      }
    ).note;
    expect(ownerView).toMatchObject({
      title: "Shopping",
      tags: ["home"],
      color: NoteColor.Yellow,
      pinned: false,
    });
    // Both hear about it, each with their own copy.
    const toOwner = eventsFor(owner.userId).at(-1);
    const toAlice = eventsFor(alice.userId).at(-1);
    expect(toOwner).toMatchObject({
      type: "note:updated",
      note: { title: "Shopping", tags: ["home"] },
    });
    expect(toAlice).toMatchObject({
      type: "note:updated",
      note: { title: "Shopping", tags: ["errands"] },
    });
  });

  it("keeps a viewer out of the note itself but lets them organize it", async () => {
    const note = await createNote();
    const view = await shareAccepted(note.id, alice, "view");
    expect(view.sharing?.role).toBe("view");

    expect(
      (await call(alice, "PUT", `/api/notes/${note.id}`, { content: "no" }))
        .status,
    ).toBe(403);
    expect(
      (await call(alice, "PUT", `/api/notes/${note.id}`, { archived: true }))
        .status,
    ).toBe(200);
  });

  it("puts a recipient's deleted note in their own trash, and empties it from there", async () => {
    const note = await createNote();
    await shareAccepted(note.id, alice);
    events.length = 0;

    const trashed = await call(alice, "PUT", `/api/notes/${note.id}`, {
      trashed: true,
    });
    expect(trashed.status).toBe(200);
    const { note: aliceView } = (await trashed.json()) as { note: Note };
    expect(aliceView.trashed).toBe(true);
    expect(aliceView.trashedAt).not.toBeNull();
    // The owner's copy is untouched, and nobody's access changed.
    expect(eventsFor(owner.userId).at(-1)).toMatchObject({
      type: "note:updated",
      note: { trashed: false },
    });
    expect(events.some((e) => e.event.type === "invitation:created")).toBe(
      false,
    );

    expect((await call(alice, "DELETE", `/api/notes/${note.id}`)).status).toBe(
      204,
    );
    expect(eventsFor(alice.userId).at(-1)).toEqual({
      type: "note:deleted",
      id: note.id,
    });
    expect((await noteAs(alice, note.id)).status).toBe(404);
    const ownerView = (
      (await (await noteAs(owner, note.id)).json()) as {
        note: Note;
      }
    ).note;
    expect(ownerView.sharing).toBeUndefined();
  });

  it("still leaves what only the owner decides to the owner", async () => {
    const note = await createNote();
    await shareAccepted(note.id, alice);
    expect(
      (await call(alice, "PUT", `/api/notes/${note.id}`, { readonly: true }))
        .status,
    ).toBe(403);
  });

  it("answers a stale recipient write with 412 and the recipient's copy", async () => {
    const note = await createNote();
    await shareAccepted(note.id, alice);
    await call(owner, "PUT", `/api/notes/${note.id}`, { title: "Newer" });
    const res = await rig.request(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: { ...authHeaders(alice.token), "If-Match": note.updatedAt },
      body: JSON.stringify({ pinned: true }),
    });
    expect(res.status).toBe(412);
    const body = (await res.json()) as { note: Note };
    expect(body.note).toMatchObject({ title: "Newer", tags: [] });
  });

  it("hides a trashed note from recipients until it is restored", async () => {
    const note = await createNote();
    await shareAccepted(note.id, alice);
    await call(owner, "PUT", `/api/notes/${note.id}`, { trashed: true });
    expect(eventsFor(alice.userId).at(-1)).toEqual({
      type: "note:deleted",
      id: note.id,
    });
    expect((await noteAs(alice, note.id)).status).toBe(404);

    await call(owner, "PUT", `/api/notes/${note.id}`, { trashed: false });
    expect(eventsFor(alice.userId).at(-1)).toMatchObject({
      type: "note:updated",
      note: { id: note.id },
    });
    expect((await noteAs(alice, note.id)).status).toBe(200);
  });

  it("changes a role and removes a person", async () => {
    const note = await createNote();
    await shareAccepted(note.id, alice);

    const changed = await call(
      owner,
      "PUT",
      `/api/notes/${note.id}/shares/${alice.userId}`,
      { role: "view" },
    );
    expect(changed.status).toBe(200);
    expect(
      ((await noteAs(alice, note.id).then((r) => r.json())) as { note: Note })
        .note.sharing?.role,
    ).toBe("view");

    const removed = await call(
      owner,
      "DELETE",
      `/api/notes/${note.id}/shares/${alice.userId}`,
    );
    expect(removed.status).toBe(204);
    expect(eventsFor(alice.userId)).toContainEqual({
      type: "note:deleted",
      id: note.id,
    });
    expect((await noteAs(alice, note.id)).status).toBe(404);
    expect(
      (
        (await noteAs(owner, note.id).then((r) => r.json())) as {
          note: Note;
        }
      ).note.sharing,
    ).toBeUndefined();
    expect(
      (
        await call(
          owner,
          "PUT",
          `/api/notes/${note.id}/shares/${alice.userId}`,
          {
            role: "edit",
          },
        )
      ).status,
    ).toBe(404);
  });

  it("lets a recipient leave, and decline an invitation", async () => {
    const note = await createNote();
    await shareAccepted(note.id, alice);
    await invite(note.id, bob, "view");

    expect(
      (
        await call(
          alice,
          "DELETE",
          `/api/notes/${note.id}/shares/${alice.userId}`,
        )
      ).status,
    ).toBe(204);
    expect((await noteAs(alice, note.id)).status).toBe(404);

    // Declining is for invitations, not a way to leave a note.
    expect(
      (await call(alice, "POST", `/api/invitations/${note.id}/decline`)).status,
    ).toBe(404);
    expect(
      (await call(bob, "POST", `/api/invitations/${note.id}/decline`)).status,
    ).toBe(204);
    expect(eventsFor(bob.userId).at(-1)).toEqual({
      type: "invitation:removed",
      noteId: note.id,
    });
    expect(
      (
        (await call(bob, "GET", "/api/invitations").then((r) =>
          r.json(),
        )) as InvitationsResponse
      ).invitations,
    ).toEqual([]);
  });

  it("tells everyone a deleted note is gone", async () => {
    const note = await createNote();
    await shareAccepted(note.id, alice);
    await invite(note.id, bob);
    expect((await call(owner, "DELETE", `/api/notes/${note.id}`)).status).toBe(
      204,
    );
    expect(eventsFor(alice.userId).at(-1)).toEqual({
      type: "note:deleted",
      id: note.id,
    });
    expect(eventsFor(bob.userId).at(-1)).toEqual({
      type: "invitation:removed",
      noteId: note.id,
    });
  });

  it("finds shared notes in search", async () => {
    const note = await createNote();
    await shareAccepted(note.id, alice, "view");
    const res = await call(alice, "GET", "/api/search?q=milk");
    const body = (await res.json()) as { notes: Note[] };
    expect(body.notes.map((n) => n.id)).toEqual([note.id]);
  });
});

describe("finding people to share with", () => {
  async function setup(userLookup: "search" | "exact") {
    const rig = await bootTestAppWith({ userLookup });
    const me = await registerTestUser(rig, "olivia");
    await registerTestUser(rig, "alice");
    const bob = await registerTestUser(rig, "bob");
    await rig.request("/api/auth/me", {
      method: "PUT",
      headers: authHeaders(bob.token),
      body: JSON.stringify({ email: "Robert@Example.com" }),
    });
    const find = async (q: string) =>
      (
        (await (
          await rig.request(`/api/users?q=${encodeURIComponent(q)}`, {
            headers: authHeaders(me.token),
          })
        ).json()) as UserLookupResponse
      ).users;
    return { rig, find };
  }

  it("searches accounts as the owner types, showing addresses", async () => {
    const { rig, find } = await setup("search");
    expect((await find("rob")).map((u) => [u.username, u.email])).toEqual([
      ["bob", "Robert@Example.com"],
    ]);
    expect((await find("LIC")).map((u) => u.username)).toEqual(["alice"]);
    expect(await find("olivia")).toEqual([]);
    expect(await find("")).toEqual([]);
    await rig.close();
  });

  it("finds only a whole username or address, and tells nothing more", async () => {
    const { rig, find } = await setup("exact");
    expect(await find("rob")).toEqual([]);
    expect(await find("ali")).toEqual([]);
    expect(await find("ALICE")).toMatchObject([{ username: "alice" }]);
    const byEmail = await find("robert@example.com");
    expect(byEmail).toMatchObject([{ username: "bob" }]);
    expect(byEmail[0]).not.toHaveProperty("email");
    const methods = await (await rig.request("/api/auth/methods")).json();
    expect(methods).toEqual({
      provider: "local",
      providers: ["local"],
      passwordForm: "shown",
      userLookup: "exact",
      webhooks: false,
      passwordReset: false,
    });
    await rig.close();
  });
});

describe("email addresses on accounts", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
  });

  function register(username: string, email?: string) {
    return rig.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "password-1234", email }),
    });
  }

  it("takes an address at registration, once per address", async () => {
    const first = await register("alice", "alice@example.com");
    expect(first.status).toBe(201);
    expect(
      ((await first.json()) as { user: { email: string } }).user.email,
    ).toBe("alice@example.com");

    const taken = await register("bob", "ALICE@example.com");
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: "email_taken" });
    expect((await register("carol", "not-an-address")).status).toBe(422);
    const none = await register("dave");
    expect(
      ((await none.json()) as { user: { email: string | null } }).user.email,
    ).toBeNull();
  });

  it("lets a user set and clear their own address", async () => {
    await register("alice", "alice@example.com");
    const bob = await registerTestUser(rig, "bob");
    const put = (email: string | null) =>
      rig.request("/api/auth/me", {
        method: "PUT",
        headers: authHeaders(bob.token),
        body: JSON.stringify({ email }),
      });

    const taken = await put("alice@example.com");
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: "email_taken" });

    const set = await put("  bob@example.com ");
    expect(set.status).toBe(200);
    expect(((await set.json()) as AuthMeResponse).user.email).toBe(
      "bob@example.com",
    );
    expect(
      ((await (await put(null)).json()) as AuthMeResponse).user.email,
    ).toBe(null);
  });

  it("lets an admin give an account an address", async () => {
    const admin = await registerTestUser(rig, "admin");
    const created = await rig.request("/api/admin/users", {
      method: "POST",
      headers: authHeaders(admin.token),
      body: JSON.stringify({ username: "erin", email: "erin@example.com" }),
    });
    expect(created.status).toBe(201);
    const { user } = (await created.json()) as AdminTemporaryPasswordResponse;
    expect(user.email).toBe("erin@example.com");

    const dup = await rig.request("/api/admin/users", {
      method: "POST",
      headers: authHeaders(admin.token),
      body: JSON.stringify({ username: "frank", email: "ERIN@example.com" }),
    });
    expect(dup.status).toBe(409);

    const changed = await rig.request(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: authHeaders(admin.token),
      body: JSON.stringify({ email: "erin@work.example" }),
    });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as AdminUserResponse).user).toMatchObject({
      email: "erin@work.example",
      isAdmin: false,
    });

    const nothing = await rig.request(`/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: authHeaders(admin.token),
      body: JSON.stringify({}),
    });
    expect(nothing.status).toBe(422);
  });

  it("tells recipients when an admin deletes the owner", async () => {
    const admin = await registerTestUser(rig, "admin");
    const owner = await registerTestUser(rig, "olivia");
    const alice = await registerTestUser(rig, "alice");
    const events: { userId: string; event: WebSocketEvent }[] = [];
    rig.broadcaster.subscribe((userId, event) =>
      events.push({ userId, event }),
    );

    const created = await rig.request("/api/notes", {
      method: "POST",
      headers: authHeaders(owner.token),
      body: JSON.stringify(baseNote),
    });
    const { note } = (await created.json()) as { note: Note };
    await rig.request(`/api/notes/${note.id}/shares`, {
      method: "POST",
      headers: authHeaders(owner.token),
      body: JSON.stringify({ userId: alice.userId, role: "edit" }),
    });
    await rig.request(`/api/invitations/${note.id}/accept`, {
      method: "POST",
      headers: authHeaders(alice.token),
    });

    const res = await rig.request(`/api/admin/users/${owner.userId}`, {
      method: "DELETE",
      headers: authHeaders(admin.token),
    });
    expect(res.status).toBe(204);
    expect(
      events.filter((e) => e.userId === alice.userId).at(-1)?.event,
    ).toEqual({ type: "note:deleted", id: note.id });
  });
});
