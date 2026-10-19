import type {
  AdminTemporaryPasswordResponse,
  AdminUserResponse,
  AuthMeResponse,
  InvitationsResponse,
  Note,
  NoteCreate,
  PublicLink,
  PublicNoteResponse,
  SealedNote,
  SeenKeysResponse,
  UserLookupResponse,
  WebSocketEvent,
} from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ciphertext, heldKey } from "#/storage/contracts/claimed.ts";
import { openedAnswer } from "#/test/sealingClient.ts";
import {
  authHeaders,
  bootTestApp,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "#/test/setup.ts";

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
      body: body === undefined ? null : JSON.stringify(body),
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
    // Read as the app would show them: a note in an event is sealed.
    return events
      .filter((e) => e.userId === userId)
      .map((e) => openedAnswer(e.event) as WebSocketEvent);
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
});

describe("handing a shared note's key on", () => {
  let rig: TestRig;
  let owner: { token: string; userId: string };
  let alice: { token: string; userId: string };
  let bob: { token: string; userId: string };

  beforeEach(async () => {
    rig = await bootTestApp();
    owner = await registerTestUser(rig, "olivia");
    alice = await registerTestUser(rig, "alice");
    bob = await registerTestUser(rig, "bob");
  });

  afterEach(async () => {
    await rig.close();
  });

  const call = (
    who: { token: string },
    method: string,
    path: string,
    body?: unknown,
  ) =>
    rig.request(path, {
      method,
      headers: authHeaders(who.token),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  const offer = (signer: string, keyVersion = 1) => ({
    keyVersion,
    ephemeral: `B${"A".repeat(86)}`,
    wrapped: ciphertext("wrapped for them"),
    signer,
    signature: "c2lnbmF0dXJl",
  });

  async function note(): Promise<Note> {
    const res = await call(owner, "POST", "/api/notes", baseNote);
    return ((await res.json()) as { note: Note }).note;
  }

  const invitationOf = async (who: { token: string }) =>
    (
      (await (
        await call(who, "GET", "/api/invitations")
      ).json()) as InvitationsResponse
    ).invitations[0];

  it("takes the key with the invitation, when the owner's client could wrap it", async () => {
    const { id } = await note();
    const res = await call(owner, "POST", `/api/notes/${id}/shares`, {
      userId: alice.userId,
      role: "edit",
      key: offer(owner.userId),
    });
    expect(res.status).toBe(201);
    expect((await invitationOf(alice))?.offered).toEqual(offer(owner.userId));
    // Signed by someone else, or for another key, it is not the owner's to
    // send.
    for (const key of [offer(bob.userId), offer(owner.userId, 2)]) {
      const bad = await call(owner, "POST", `/api/notes/${id}/shares`, {
        userId: bob.userId,
        role: "edit",
        key,
      });
      expect(bad.status).toBe(422);
    }
  });

  it("lets anyone who holds the note wrap its key for someone still waiting", async () => {
    const { id } = await note();
    await call(owner, "POST", `/api/notes/${id}/shares`, {
      userId: alice.userId,
      role: "view",
    });
    await call(owner, "POST", `/api/notes/${id}/shares`, {
      userId: bob.userId,
      role: "view",
    });
    expect((await invitationOf(bob))?.offered).toBeNull();
    const put = (who: { token: string; userId: string }, signer = who.userId) =>
      call(
        who,
        "PUT",
        `/api/notes/${id}/shares/${bob.userId}/key`,
        offer(signer),
      );
    // Someone who has not accepted holds no key to wrap.
    expect((await put(alice)).status).toBe(404);
    await call(alice, "POST", `/api/invitations/${id}/accept`);
    expect((await put(alice, owner.userId)).status).toBe(422);
    expect((await put(alice)).status).toBe(204);
    expect((await invitationOf(bob))?.offered?.signer).toBe(alice.userId);
    // Offered one, bob is not waiting: nobody but the owner puts another in
    // its place, or any holder could swap in a key of their own making.
    expect((await put(alice)).status).toBe(409);
    expect((await invitationOf(bob))?.offered?.signer).toBe(alice.userId);
    expect((await put(owner)).status).toBe(204);
    expect((await invitationOf(bob))?.offered?.signer).toBe(owner.userId);
    // Nobody is waiting any more, as everyone on the note can see.
    const seen = await call(owner, "GET", `/api/notes/${id}`);
    const { note: ownerView } = (await seen.json()) as { note: Note };
    expect(ownerView.sharing?.members.some((m) => m.waitingForKey)).toBe(false);
  });

  it("refuses an invitation's acceptance under another key, and a readable one", async () => {
    const { id } = await note();
    await call(owner, "POST", `/api/notes/${id}/shares`, {
      userId: alice.userId,
      role: "edit",
    });
    const accept = (body: object) =>
      rig.rawRequest(`/api/invitations/${id}/accept`, {
        method: "POST",
        headers: authHeaders(alice.token),
        body: JSON.stringify(body),
      });
    expect((await accept({})).status).toBe(422);
    expect((await accept({ key: "readable", keyVersion: 1 })).status).toBe(422);
    expect((await accept({ ...heldKey, keyVersion: 2 })).status).toBe(409);
    expect((await accept(heldKey)).status).toBe(200);
  });

  const sealedAs = async (who: { token: string }, id: string) =>
    (
      (await (
        await rig.rawRequest(`/api/notes/${id}`, {
          headers: authHeaders(who.token),
        })
      ).json()) as { note: SealedNote }
    ).note;

  const rekeyed = (keyVersion: number, extra: object = {}) => ({
    keyVersion,
    key: ciphertext(`owner's copy of key ${keyVersion}`),
    previousKeys: ciphertext("the keys before"),
    title: ciphertext("Groceries"),
    content: ciphertext("- [ ] Milk"),
    excerpt: ciphertext("- [ ] Milk"),
    font: ciphertext("default"),
    images: ciphertext("[]"),
    linkPreviews: ciphertext("[]"),
    ...extra,
  });

  /** As the app sends it: from the note as it was just read, unless a test
   * says which read (`ifMatch`), or sends none (null). */
  const rekey = async (
    who: { token: string },
    id: string,
    body: object,
    ifMatch?: string | null,
  ) => {
    const read =
      ifMatch === undefined ? (await sealedAs(who, id)).updatedAt : ifMatch;
    return rig.rawRequest(`/api/notes/${id}/key`, {
      method: "PUT",
      headers: {
        ...authHeaders(who.token),
        ...(read !== null && { "If-Match": read }),
      },
      body: JSON.stringify(body),
    });
  };

  it("is due a new key once someone who held it is gone, which only the owner is told", async () => {
    const { id } = await note();
    for (const who of [alice, bob]) {
      await call(owner, "POST", `/api/notes/${id}/shares`, {
        userId: who.userId,
        role: "edit",
      });
    }
    // Bob was never handed a key: his going gives nothing away.
    await call(owner, "DELETE", `/api/notes/${id}/shares/${bob.userId}`);
    expect((await sealedAs(owner, id)).rekeyDue).toBeUndefined();

    await call(alice, "POST", `/api/invitations/${id}/accept`);
    await call(owner, "POST", `/api/notes/${id}/shares`, {
      userId: bob.userId,
      role: "edit",
    });
    await call(bob, "POST", `/api/invitations/${id}/accept`);
    // Alice leaves, holding the key.
    await call(alice, "DELETE", `/api/notes/${id}`);
    expect((await sealedAs(owner, id)).rekeyDue).toBe(true);
    expect((await sealedAs(bob, id)).rekeyDue).toBeUndefined();
  });

  it("moves the whole note to a new key at once, and leaves everyone else waiting for it", async () => {
    const { id } = await note();
    await call(owner, "POST", `/api/notes/${id}/shares`, {
      userId: alice.userId,
      role: "edit",
    });
    await call(owner, "POST", `/api/notes/${id}/shares`, {
      userId: bob.userId,
      role: "edit",
    });
    await call(alice, "POST", `/api/invitations/${id}/accept`);
    await call(bob, "POST", `/api/invitations/${id}/accept`);
    await call(owner, "DELETE", `/api/notes/${id}/shares/${alice.userId}`);

    // Not a recipient's to do, not to a version it is not next at, and not
    // with anything readable in it.
    expect((await rekey(bob, id, rekeyed(2))).status).toBe(404);
    expect((await rekey(owner, id, rekeyed(3))).status).toBe(409);
    expect(
      (await rekey(owner, id, rekeyed(2, { title: "Groceries" }))).status,
    ).toBe(422);
    const { title: _title, ...partial } = rekeyed(2);
    expect((await rekey(owner, id, partial)).status).toBe(422);
    // Not without saying which read the fields were sealed again from, and
    // not from one the note has been written since: Bob's edit, made while
    // the owner's app was sealing, is not in what it sends.
    expect((await rekey(owner, id, rekeyed(2), null)).status).toBe(428);
    const read = (await sealedAs(owner, id)).updatedAt;
    const edit = await rig.rawRequest(`/api/notes/${id}`, {
      method: "PUT",
      headers: authHeaders(bob.token),
      body: JSON.stringify({
        title: ciphertext("Bob's edit"),
        keyVersion: 1,
        format: 1,
      }),
    });
    expect(edit.status).toBe(200);
    expect((await rekey(owner, id, rekeyed(2), read)).status).toBe(412);
    expect(await sealedAs(owner, id)).toMatchObject({
      keyVersion: 1,
      title: ciphertext("Bob's edit"),
    });

    const done = await rekey(owner, id, rekeyed(2));
    expect(done.status).toBe(200);
    const mine = ((await done.json()) as { note: SealedNote }).note;
    expect(mine).toMatchObject({
      keyVersion: 2,
      key: ciphertext("owner's copy of key 2"),
      previousKeys: ciphertext("the keys before"),
    });
    expect(mine.rekeyDue).toBeUndefined();
    expect(mine.sharing?.members).toEqual([
      expect.objectContaining({ id: bob.userId, waitingForKey: true }),
    ]);
    expect((await rekey(owner, id, rekeyed(2))).status).toBe(409);

    // Bob's copy is behind: he is handed nothing that opens the note, and
    // what he seals under the old key is refused.
    const behind = await sealedAs(bob, id);
    expect(behind).toMatchObject({ keyVersion: 2, key: "" });
    expect(behind.offered).toBeUndefined();
    const stale = await rig.rawRequest(`/api/notes/${id}`, {
      method: "PUT",
      headers: authHeaders(bob.token),
      body: JSON.stringify({
        title: ciphertext("Under the old key"),
        keyVersion: 1,
        format: 1,
      }),
    });
    expect(stale.status).toBe(409);

    // The owner's client wraps the new key for him, and he keeps it.
    expect(
      (
        await call(
          owner,
          "PUT",
          `/api/notes/${id}/shares/${bob.userId}/key`,
          offer(owner.userId, 2),
        )
      ).status,
    ).toBe(204);
    expect((await sealedAs(bob, id)).offered).toEqual(offer(owner.userId, 2));
    const kept = await rig.rawRequest(`/api/notes/${id}/held-key`, {
      method: "PUT",
      headers: authHeaders(bob.token),
      body: JSON.stringify({
        key: ciphertext("bob's copy of key 2"),
        keyVersion: 2,
      }),
    });
    expect(kept.status).toBe(200);
    expect(await sealedAs(bob, id)).toMatchObject({
      key: ciphertext("bob's copy of key 2"),
      previousKeys: ciphertext("the keys before"),
    });
    const fresh = await rig.rawRequest(`/api/notes/${id}`, {
      method: "PUT",
      headers: authHeaders(bob.token),
      body: JSON.stringify({
        title: ciphertext("Under the new key"),
        keyVersion: 2,
        format: 1,
      }),
    });
    expect(fresh.status).toBe(200);
  });

  it("is due a new key when a live link is revoked, and hands the new one to the links that stay", async () => {
    const { id } = await note();
    const publish = async (mode: string) =>
      (
        (await (
          await call(owner, "POST", `/api/notes/${id}/links`, { mode })
        ).json()) as { link: PublicLink }
      ).link.token;
    const copy = await publish("snapshot");
    const gone = await publish("live");
    const stays = await publish("live");

    await call(owner, "DELETE", `/api/notes/${id}/links/${copy}`);
    expect((await sealedAs(owner, id)).rekeyDue).toBeUndefined();
    await call(owner, "DELETE", `/api/notes/${id}/links/${gone}`);
    expect((await sealedAs(owner, id)).rekeyDue).toBe(true);

    const done = await rekey(
      owner,
      id,
      rekeyed(2, {
        links: [
          { token: stays, wrappedKey: ciphertext("key 2, for the link") },
        ],
      }),
    );
    expect(done.status).toBe(200);
    const shown = (await (
      await rig.rawRequest(`/api/public/${stays}`)
    ).json()) as PublicNoteResponse;
    expect(shown.wrappedKey).toBe(ciphertext("key 2, for the link"));
    expect(shown.note.keyVersion).toBe(2);
  });

  it("keeps what an account remembers of other people's keys, sealed and its own", async () => {
    const seen = async (who: { token: string }) =>
      (
        (await (
          await call(who, "GET", "/api/auth/keys/seen")
        ).json()) as SeenKeysResponse
      ).seen;
    expect(await seen(owner)).toEqual({});
    const put = (sealed: string) =>
      call(owner, "PUT", `/api/auth/keys/seen/${alice.userId}`, { sealed });
    expect((await put("their keys, readable")).status).toBe(422);
    expect((await put(ciphertext("first sight"))).status).toBe(204);
    expect((await put(ciphertext("agreed to since"))).status).toBe(204);
    expect(await seen(owner)).toEqual({
      [alice.userId]: ciphertext("agreed to since"),
    });
    // Nobody else's list.
    expect(await seen(alice)).toEqual({});
  });

  it("gives out an account's public keys once it has them", async () => {
    const before = await call(owner, "GET", `/api/users/${alice.userId}/keys`);
    expect(before.status).toBe(404);
    const publicKeys = {
      exchange: `B${"x".repeat(86)}`,
      signing: `B${"y".repeat(86)}`,
    };
    const setup = await call(alice, "PUT", "/api/auth/keys", {
      wrappedBySecret: ciphertext("a"),
      wrappedByRecovery: ciphertext("b"),
      recoveryVerifier: "v".repeat(43),
      publicKeys,
      wrappedPrivateKeys: {
        exchange: ciphertext("c"),
        signing: ciphertext("d"),
      },
    });
    expect(setup.status).toBe(204);
    const res = await call(owner, "GET", `/api/users/${alice.userId}/keys`);
    expect(await res.json()).toEqual({
      userId: alice.userId,
      version: 1,
      publicKeys,
    });
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
      body: JSON.stringify({
        email: "Robert@Example.com",
        password: "test-pass-12",
      }),
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
    const { features } = await (await rig.request("/api/capabilities")).json();
    expect(features.userLookup).toBe("exact");
    await rig.close();
  });

  it("never offers the account asking, by name or by address", async () => {
    const { rig, find } = await setup("exact");
    expect(await find("olivia")).toEqual([]);
    await rig.close();
  });

  it("names an account once when its username and its address both match", async () => {
    const { rig, find } = await setup("exact");
    const carol = await registerTestUser(rig, "carol@example.com");
    const set = await rig.request("/api/auth/me", {
      method: "PUT",
      headers: authHeaders(carol.token),
      body: JSON.stringify({
        email: "carol@example.com",
        password: "test-pass-12",
      }),
    });
    expect(set.status).toBe(200);
    expect(await find("carol@example.com")).toMatchObject([
      { username: "carol@example.com" },
    ]);
    await rig.close();
  });

  it("answers a query longer than any address with nobody", async () => {
    const { rig, find } = await setup("search");
    expect(await find("a".repeat(255))).toEqual([]);
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
        body: JSON.stringify({ email, password: "test-pass-12" }),
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
