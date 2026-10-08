import type {
  Note,
  NoteComment,
  NoteCommentResponse,
  NoteCommentsResponse,
  NoteCreate,
  WebSocketEvent,
} from "@manifesto/shared";
import {
  MAX_COMMENT_LENGTH,
  MAX_COMMENTS_PER_NOTE,
  NoteColor,
  NoteFont,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

const baseNote: NoteCreate = {
  title: "Trip plan",
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

interface Account {
  token: string;
  userId: string;
}

describe("comments beside a shared note", () => {
  let rig: TestRig;
  let owner: Account;
  let editor: Account;
  let viewer: Account;
  let stranger: Account;
  let noteId: string;
  let events: { userId: string; event: WebSocketEvent }[];

  function call(who: Account, method: string, path: string, body?: unknown) {
    return rig.request(path, {
      method,
      headers: authHeaders(who.token),
      body: body === undefined ? null : JSON.stringify(body),
    });
  }

  async function share(who: Account, role: "edit" | "view") {
    const invited = await call(owner, "POST", `/api/notes/${noteId}/shares`, {
      userId: who.userId,
      role,
    });
    expect(invited.status).toBe(201);
    const accepted = await call(
      who,
      "POST",
      `/api/invitations/${noteId}/accept`,
    );
    expect(accepted.status).toBe(200);
  }

  const path = (commentId?: string) =>
    `/api/notes/${noteId}/comments${commentId ? `/${commentId}` : ""}`;

  async function write(who: Account, body: string): Promise<NoteComment> {
    const res = await call(who, "POST", path(), { body });
    expect(res.status).toBe(201);
    return ((await res.json()) as NoteCommentResponse).comment;
  }

  async function list(who: Account): Promise<NoteComment[]> {
    const res = await call(who, "GET", path());
    expect(res.status).toBe(200);
    return ((await res.json()) as NoteCommentsResponse).comments;
  }

  const commentEvents = (who: Account) =>
    events
      .filter(
        (e) => e.userId === who.userId && e.event.type.startsWith("comment:"),
      )
      .map((e) => e.event.type);

  beforeEach(async () => {
    rig = await bootTestApp();
    owner = await registerTestUser(rig, "olivia");
    editor = await registerTestUser(rig, "eddie");
    viewer = await registerTestUser(rig, "vera");
    stranger = await registerTestUser(rig, "sam");
    const created = await call(owner, "POST", "/api/notes", baseNote);
    noteId = ((await created.json()) as { note: Note }).note.id;
    await share(editor, "edit");
    await share(viewer, "view");
    events = [];
    rig.broadcaster.subscribe((userId, event) =>
      events.push({ userId, event }),
    );
  });

  afterEach(async () => {
    await rig.close();
  });

  it("lets everyone on the note write and read, a viewer included, oldest first", async () => {
    const first = await write(owner, "  Shall we take the train?  ");
    await write(viewer, "Yes please");
    await write(editor, "Booked");

    expect(first).toMatchObject({
      noteId,
      body: "Shall we take the train?",
      author: { id: owner.userId, username: "olivia" },
      editedAt: null,
    });
    for (const who of [owner, editor, viewer]) {
      expect((await list(who)).map((c) => c.body)).toEqual([
        "Shall we take the train?",
        "Yes please",
        "Booked",
      ]);
    }
  });

  it("is not there for someone who cannot see the note", async () => {
    await write(owner, "Private");
    expect((await call(stranger, "GET", path())).status).toBe(404);
    expect((await call(stranger, "POST", path(), { body: "hi" })).status).toBe(
      404,
    );
  });

  it("refuses an empty comment and one too long", async () => {
    expect((await call(owner, "POST", path(), { body: "   " })).status).toBe(
      422,
    );
    const long = "x".repeat(MAX_COMMENT_LENGTH + 1);
    expect((await call(owner, "POST", path(), { body: long })).status).toBe(
      422,
    );
  });

  it("tells everyone on the note, and nobody else", async () => {
    const comment = await write(viewer, "Hello");
    await call(viewer, "PUT", path(comment.id), { body: "Hello all" });
    await call(viewer, "DELETE", path(comment.id));

    const all = ["comment:created", "comment:updated", "comment:deleted"];
    expect(commentEvents(owner)).toEqual(all);
    expect(commentEvents(editor)).toEqual(all);
    expect(commentEvents(viewer)).toEqual(all);
    expect(commentEvents(stranger)).toEqual([]);
  });

  it("leaves the note itself untouched", async () => {
    const before = (await (
      await call(owner, "GET", `/api/notes/${noteId}`)
    ).json()) as { note: Note };
    await write(editor, "Beside, not inside");
    const after = (await (
      await call(owner, "GET", `/api/notes/${noteId}`)
    ).json()) as { note: Note };
    expect(after.note.updatedAt).toBe(before.note.updatedAt);
    expect(after.note.content).toBe(before.note.content);
    expect(events.some((e) => e.event.type === "note:updated")).toBe(false);
  });

  it("lets only the author edit, and marks the comment as edited", async () => {
    const comment = await write(editor, "Bokked");
    expect(
      (await call(owner, "PUT", path(comment.id), { body: "Booked" })).status,
    ).toBe(403);
    const res = await call(editor, "PUT", path(comment.id), { body: "Booked" });
    expect(res.status).toBe(200);
    const edited = ((await res.json()) as NoteCommentResponse).comment;
    expect(edited.body).toBe("Booked");
    expect(edited.editedAt).not.toBeNull();
    expect(edited.createdAt).toBe(comment.createdAt);

    // The same text again is no edit.
    events = [];
    const same = await call(editor, "PUT", path(comment.id), {
      body: "Booked",
    });
    expect(((await same.json()) as NoteCommentResponse).comment.editedAt).toBe(
      edited.editedAt,
    );
    expect(commentEvents(owner)).toEqual([]);
  });

  it("lets the author or the note's owner delete, and nobody else", async () => {
    const mine = await write(viewer, "Mine");
    const theirs = await write(editor, "Theirs");
    expect((await call(viewer, "DELETE", path(theirs.id))).status).toBe(403);
    expect((await call(viewer, "DELETE", path(mine.id))).status).toBe(204);
    expect((await call(owner, "DELETE", path(theirs.id))).status).toBe(204);
    expect(await list(owner)).toEqual([]);
    expect((await call(owner, "DELETE", path(theirs.id))).status).toBe(404);
  });

  it("does not reach a comment through another note", async () => {
    const comment = await write(editor, "Here");
    const other = await call(editor, "POST", "/api/notes", baseNote);
    const otherId = ((await other.json()) as { note: Note }).note.id;
    const through = `/api/notes/${otherId}/comments/${comment.id}`;
    expect((await call(editor, "DELETE", through)).status).toBe(404);
    expect((await call(editor, "PUT", through, { body: "x" })).status).toBe(
      404,
    );
    expect(await list(owner)).toHaveLength(1);
  });

  it("keeps a removed person's comments, without their name", async () => {
    await write(editor, "I was here");
    await write(owner, "So was I");
    const removed = await call(
      owner,
      "DELETE",
      `/api/notes/${noteId}/shares/${editor.userId}`,
    );
    expect(removed.status).toBe(204);

    expect(
      (await list(owner)).map((c) => [c.body, c.author?.username ?? null]),
    ).toEqual([
      ["I was here", null],
      ["So was I", "olivia"],
    ]);
    // They are off the note, and so off its comments.
    expect((await call(editor, "GET", path())).status).toBe(404);

    // Shared with again, the name comes back: nothing was rewritten.
    await share(editor, "view");
    expect((await list(viewer))[0]?.author?.username).toBe("eddie");
  });

  it("anonymises someone who left the note themselves, and a deleted account", async () => {
    await write(viewer, "Bye");
    await write(editor, "Gone soon");
    await call(
      viewer,
      "DELETE",
      `/api/notes/${noteId}/shares/${viewer.userId}`,
    );
    await rig.storage.users.delete(editor.userId);

    expect((await list(owner)).map((c) => [c.body, c.author])).toEqual([
      ["Bye", null],
      ["Gone soon", null],
    ]);
  });

  it("lets the owner delete a comment whose author is gone", async () => {
    const comment = await write(editor, "Orphan");
    await call(owner, "DELETE", `/api/notes/${noteId}/shares/${editor.userId}`);
    expect((await call(owner, "DELETE", path(comment.id))).status).toBe(204);
  });

  it("hides the comments with a note in its owner's trash, and removes them with the note", async () => {
    const comment = await write(editor, "Still here?");
    const note = (await (
      await call(owner, "GET", `/api/notes/${noteId}`)
    ).json()) as { note: Note };
    await rig.request(`/api/notes/${noteId}`, {
      method: "PUT",
      headers: { ...authHeaders(owner.token), "If-Match": note.note.updatedAt },
      body: JSON.stringify({ trashed: true }),
    });
    expect((await call(editor, "GET", path())).status).toBe(404);
    expect(await list(owner)).toHaveLength(1);

    events = [];
    await write(owner, "Only I see this");
    expect(commentEvents(editor)).toEqual([]);

    await call(owner, "DELETE", `/api/notes/${noteId}`);
    expect(await rig.storage.comments.get(comment.id)).toBeNull();
  });

  it("holds only so many comments on one note", async () => {
    for (let i = 0; i < MAX_COMMENTS_PER_NOTE; i++) {
      await rig.storage.comments.create(
        {
          id: `c${String(i).padStart(4, "0")}`,
          noteId,
          authorId: owner.userId,
          body: "x",
          createdAt: "2026-04-01T00:00:00.000Z",
          editedAt: null,
        },
        MAX_COMMENTS_PER_NOTE,
      );
    }
    expect(
      (await call(owner, "POST", path(), { body: "one more" })).status,
    ).toBe(409);
  });
});
