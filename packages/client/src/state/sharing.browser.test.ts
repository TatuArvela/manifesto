import {
  type Note,
  NoteColor,
  NoteFont,
  type NoteSharing,
  type ShareInvitation,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageConnection } from "../storage/index.js";
import { exportNotes, notes, updateNote } from "./actions.js";
import { locale } from "./prefs.js";
import {
  acceptInvitation,
  declineInvitation,
  findUsers,
  invitations,
  leaveNote,
  receiveInvitation,
  removeShare,
  shareNote,
} from "./sharing.js";
import { editingNoteId, toasts } from "./ui.js";

const SERVER = "http://server.test";

const owner = {
  id: "u-olivia",
  username: "olivia",
  displayName: "Olivia",
  avatarColor: "#ef4444",
};

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Groceries",
    content: "- [ ] Milk",
    color: NoteColor.Yellow,
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
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function sharedAs(role: NoteSharing["role"]): NoteSharing {
  return {
    role,
    owner,
    members: [
      {
        id: "u-alice",
        username: "alice",
        displayName: "alice",
        avatarColor: "#3b82f6",
        role: role === "owner" ? "edit" : role,
        accepted: true,
      },
    ],
  };
}

function invitation(overrides: Partial<ShareInvitation> = {}): ShareInvitation {
  return {
    noteId: "n1",
    role: "edit",
    owner,
    title: "Groceries",
    content: "- [ ] Milk",
    color: NoteColor.Yellow,
    font: NoteFont.Default,
    invitedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  locale.value = "en";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  storageConnection.value = { serverUrl: SERVER, token: "tok" };
  notes.value = [];
  invitations.value = [];
  toasts.value = [];
  editingNoteId.value = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  storageConnection.value = { serverUrl: null, token: null };
  notes.value = [];
  invitations.value = [];
  toasts.value = [];
  editingNoteId.value = null;
});

const messages = () => toasts.value.map((toast) => toast.message);

describe("invitations", () => {
  it("says so when an invitation arrives, and not again when it is refreshed", () => {
    receiveInvitation(invitation());
    receiveInvitation(invitation({ role: "view" }));
    expect(invitations.value).toEqual([invitation({ role: "view" })]);
    expect(messages()).toEqual(["Olivia wants to share a note with you"]);
  });

  it("accepts one, putting the note among the user's notes", async () => {
    invitations.value = [invitation()];
    const note = makeNote({ sharing: sharedAs("edit") });
    fetchMock.mockResolvedValueOnce(json({ note }));

    expect(await acceptInvitation("n1")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${SERVER}/api/invitations/n1/accept`);
    expect(init?.method).toBe("POST");
    expect(invitations.value).toEqual([]);
    expect(notes.value).toEqual([note]);
  });

  it("drops an invitation that is gone by the time it is accepted", async () => {
    invitations.value = [invitation()];
    fetchMock.mockResolvedValueOnce(
      json({ error: "Invitation not found" }, 404),
    );

    expect(await acceptInvitation("n1")).toBe(false);
    expect(invitations.value).toEqual([]);
    expect(messages()).toEqual([
      "That note is no longer being shared with you.",
    ]);
  });

  it("declines one", async () => {
    invitations.value = [invitation()];
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await declineInvitation("n1")).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${SERVER}/api/invitations/n1/decline`,
    );
    expect(invitations.value).toEqual([]);
  });
});

describe("sharing a note", () => {
  it("looks nobody up for an empty query, and tells a failure from no matches", async () => {
    expect(await findUsers("  ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json({ users: [] }));
    expect(await findUsers("zed")).toEqual([]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${SERVER}/api/users?q=zed`);

    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await findUsers("zed")).toBeNull();
    expect(messages()).toEqual(["Could not look anyone up."]);
  });

  it("invites someone and takes the server's copy of the note", async () => {
    notes.value = [makeNote()];
    const shared = makeNote({ sharing: sharedAs("owner") });
    fetchMock.mockResolvedValueOnce(json({ note: shared }, 201));

    expect(await shareNote("n1", "u-alice", "view")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${SERVER}/api/notes/n1/shares`);
    expect(JSON.parse(String(init?.body))).toEqual({
      userId: "u-alice",
      role: "view",
    });
    expect(notes.value).toEqual([shared]);
  });

  it("says a note is already shared in its own words", async () => {
    notes.value = [makeNote()];
    fetchMock.mockResolvedValueOnce(json({ error: "already" }, 409));
    expect(await shareNote("n1", "u-alice", "edit")).toBe(false);
    expect(messages()).toEqual(["The note is already shared with them."]);
  });

  it("takes a removed person off the note at once, and the sharing with the last one", async () => {
    notes.value = [makeNote({ sharing: sharedAs("owner") })];
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await removeShare("n1", "u-alice")).toBe(true);
    expect(notes.value[0]?.sharing).toBeUndefined();
  });

  it("leaves a note, closing it if it is open", async () => {
    notes.value = [makeNote({ sharing: sharedAs("edit") })];
    editingNoteId.value = "n1";
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await leaveNote("n1", "u-alice")).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${SERVER}/api/notes/n1/shares/u-alice`,
    );
    expect(notes.value).toEqual([]);
    expect(editingNoteId.value).toBeNull();
  });
});

describe("writing a shared note", () => {
  it("does not send a viewer's change to the note itself", async () => {
    notes.value = [makeNote({ sharing: sharedAs("view") })];
    expect(await updateNote("n1", { content: "- [x] Milk" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(messages()).toEqual(["You can view this note but not change it."]);
  });

  it("leaves the trash to the owner, even for an editor", async () => {
    notes.value = [makeNote({ sharing: sharedAs("edit") })];
    expect(
      await updateNote("n1", { trashed: true, trashedAt: "2026-04-02" }),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(messages()).toEqual(["Only the note's owner can do that."]);
  });

  it("sends a viewer's own pin, and an editor's text", async () => {
    const viewed = makeNote({ id: "v", sharing: sharedAs("view") });
    const edited = makeNote({ id: "e", sharing: sharedAs("edit") });
    notes.value = [viewed, edited];
    fetchMock
      .mockResolvedValueOnce(json({ note: { ...viewed, pinned: true } }))
      .mockResolvedValueOnce(json({ note: { ...edited, title: "Shop" } }));

    expect(await updateNote("v", { pinned: true })).toBe(true);
    expect(await updateNote("e", { title: "Shop" })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(messages()).toEqual([]);
  });

  it("leaves who has a note out of an export", async () => {
    notes.value = [makeNote({ sharing: sharedAs("owner") })];
    const exported = await exportNotes();
    expect(JSON.parse(exported ?? "[]")[0]).not.toHaveProperty("sharing");
  });
});
