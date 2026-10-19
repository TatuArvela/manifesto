import type { Note, NoteCreate, WebSocketEvent } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "#/test/setup.ts";
import { createAccessChanges } from "./accessChanges.ts";
import { emptyAccount } from "./emptyAccount.ts";
import { createNoteEvents } from "./noteEvents.ts";

const baseNote: NoteCreate = {
  title: "",
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

/**
 * Starting an account again: its keys are gone, so what was sealed under
 * them goes too, and what others shared with it is given up.
 */
describe("emptyAccount", () => {
  let rig: TestRig;
  let alice: Account;
  let bob: Account;
  let heard: [string, WebSocketEvent][];

  beforeEach(async () => {
    rig = await bootTestApp();
    alice = await registerTestUser(rig, "alice");
    bob = await registerTestUser(rig, "bob");
    heard = [];
    rig.broadcaster.subscribe((userId, event) => heard.push([userId, event]));
  });

  afterEach(async () => {
    await rig.close();
  });

  const call = (who: Account, method: string, path: string, body?: unknown) =>
    rig.request(path, {
      method,
      headers: authHeaders(who.token),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  async function create(who: Account, title: string): Promise<Note> {
    const res = await call(who, "POST", "/api/v1/notes", {
      ...baseNote,
      title,
    });
    return ((await res.json()) as { note: Note }).note;
  }

  async function share(note: Note, from: Account, to: Account, accept = true) {
    await call(from, "POST", `/api/v1/notes/${note.id}/shares`, {
      userId: to.userId,
      role: "edit",
    });
    if (accept) await call(to, "POST", `/api/v1/invitations/${note.id}/accept`);
  }

  async function idsOf(who: Account): Promise<string[]> {
    const res = await call(who, "GET", "/api/v1/notes");
    return ((await res.json()) as { notes: Note[] }).notes.map((n) => n.id);
  }

  const empty = () =>
    emptyAccount(
      {
        storage: rig.storage,
        noteEvents: createNoteEvents({
          storage: rig.storage,
          broadcaster: rig.broadcaster,
          accessChanges: createAccessChanges(),
        }),
      },
      bob.userId,
    );

  it("removes the account's notes from everyone who held them", async () => {
    const bobs = await create(bob, "Bob's");
    await share(bobs, bob, alice);
    heard.length = 0;

    await empty();

    expect(await idsOf(bob)).toEqual([]);
    expect(await idsOf(alice)).toEqual([]);
    expect(heard).toContainEqual([
      alice.userId,
      { type: "note:deleted", id: bobs.id },
    ]);
  });

  it("gives up what was shared with it, and leaves those notes with their owners", async () => {
    const shared = await create(alice, "Alice's");
    const offered = await create(alice, "Offered");
    await share(shared, alice, bob);
    await share(offered, alice, bob, false);

    await empty();

    expect(await idsOf(bob)).toEqual([]);
    expect((await idsOf(alice)).sort()).toEqual([shared.id, offered.id].sort());
    const invitations = await call(bob, "GET", "/api/v1/invitations");
    expect(await invitations.json()).toEqual({ invitations: [] });
    // The owner sees that nobody holds either note any more.
    const res = await call(alice, "GET", `/api/v1/notes/${shared.id}`);
    expect(((await res.json()) as { note: Note }).note.sharing).toBeUndefined();
  });

  it("gives up a note its owner has in the trash, which no listing shows", async () => {
    const shared = await create(alice, "Alice's");
    await share(shared, alice, bob);
    await call(alice, "PUT", `/api/v1/notes/${shared.id}`, { trashed: true });
    expect(await idsOf(bob)).toEqual([]);

    await empty();

    // Restored, it would have come back under a key the account has lost.
    expect(await rig.storage.shares.listByRecipient(bob.userId)).toEqual([]);
    await call(alice, "PUT", `/api/v1/notes/${shared.id}`, { trashed: false });
    expect(await idsOf(bob)).toEqual([]);
  });

  it("removes its preferences", async () => {
    await call(bob, "PATCH", "/api/v1/auth/me/prefs", {
      prefs: { hiddenTags: ["work"] },
    });
    await empty();
    const res = await call(bob, "GET", "/api/v1/auth/me/prefs");
    expect(await res.json()).toEqual({ prefs: {} });
  });
});
