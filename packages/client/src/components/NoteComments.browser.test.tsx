import {
  type Note,
  NoteColor,
  type NoteComment,
  NoteFont,
  type ShareUser,
} from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { plural, t } from "../i18n/index.js";
import { currentUser } from "../state/auth.js";
import {
  commentLoadsFailed,
  forgetComment,
  noteComments,
  receiveComment,
  reloadComments,
} from "../state/comments.js";
import { answerConfirmation, confirmRequest } from "../state/confirm.js";
import { locale } from "../state/prefs.js";
import { toasts } from "../state/ui.js";
import { storageConnection } from "../storage/index.js";
import { NoteComments } from "./NoteComments.js";

const SERVER = "http://server.test";

const olivia: ShareUser = {
  id: "u-olivia",
  username: "olivia",
  displayName: "Olivia",
  avatarColor: "#ef4444",
};
const alice: ShareUser = {
  id: "u-alice",
  username: "alice",
  displayName: "Alice",
  avatarColor: "#3b82f6",
};

function sharedNote(role: "owner" | "edit" | "view"): Note {
  return {
    id: "n1",
    title: "Trip",
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
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    sharing: {
      role,
      owner: olivia,
      members: [
        { ...alice, role: role === "owner" ? "edit" : role, accepted: true },
      ],
    },
  };
}

function comment(overrides: Partial<NoteComment> = {}): NoteComment {
  return {
    id: "c1",
    noteId: "n1",
    author: olivia,
    body: "Shall we take the train?",
    createdAt: "2026-04-01T10:00:00.000Z",
    editedAt: null,
    ...overrides,
  };
}

/** The server's side of the comments, for the fetch stub below. */
let stored: NoteComment[] = [];
const requests: { method: string; path: string; body: unknown }[] = [];
/** Answers the next read in place of `stored`, once. */
let nextRead: (() => Promise<Response>) | null = null;
const reads = () => requests.filter((r) => r.method === "GET").length;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
  const path = String(input).replace(`${SERVER}/api`, "");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ method, path, body });
  const id = path.split("/comments/")[1];
  if (method === "GET") {
    const read = nextRead;
    nextRead = null;
    return read ? read() : json({ comments: stored });
  }
  if (method === "POST") {
    const made = comment({
      id: `c${stored.length + 1}`,
      author: currentUser.value?.id === alice.id ? alice : olivia,
      body: body.body,
    });
    stored = [...stored, made];
    return json({ comment: made }, 201);
  }
  if (method === "PUT") {
    const edited = {
      ...(stored.find((c) => c.id === id) as NoteComment),
      body: body.body,
      editedAt: "2026-04-01T11:00:00.000Z",
    };
    stored = stored.map((c) => (c.id === id ? edited : c));
    return json({ comment: edited });
  }
  stored = stored.filter((c) => c.id !== id);
  return new Response(null, { status: 204 });
});

let host: HTMLDivElement;

const toggle = () => host.querySelector<HTMLButtonElement>("section > button");
const rows = () =>
  [...host.querySelectorAll("li")].map((li) => li.textContent ?? "");
const labelled = (label: string) =>
  host.querySelector<HTMLElement>(`[aria-label="${label}"]`);

function type(field: HTMLTextAreaElement, value: string) {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const tick = () => new Promise((r) => requestAnimationFrame(r));

/**
 * Takes the panel down and waits for it to let go. Preact runs an effect's
 * cleanup after the next paint, not at the unmount itself.
 */
async function close() {
  render(null, host);
  await tick();
  await new Promise((r) => setTimeout(r, 0));
}
const retry = () =>
  [...host.querySelectorAll("button")].find(
    (b) => b.textContent === t("comments.retry"),
  );

async function show(note: Note, me: ShareUser) {
  currentUser.value = { ...me, email: null, isAdmin: false };
  render(<NoteComments note={note} />, host);
  await vi.waitFor(() => expect(noteComments.value.has("n1")).toBe(true));
}

async function open() {
  toggle()?.click();
  await vi.waitFor(() =>
    expect(labelled(t("comments.placeholder"))).toBeTruthy(),
  );
}

beforeEach(() => {
  locale.value = "en";
  stored = [];
  requests.length = 0;
  nextRead = null;
  commentLoadsFailed.value = new Set();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  storageConnection.value = { serverUrl: SERVER, token: "tok" };
  noteComments.value = new Map();
  toasts.value = [];
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(async () => {
  await close();
  host.remove();
  vi.unstubAllGlobals();
  storageConnection.value = { serverUrl: null, token: null };
  currentUser.value = null;
  noteComments.value = new Map();
});

describe("NoteComments", () => {
  it("is not there for a note nobody else is on", async () => {
    const { sharing: _none, ...alone } = sharedNote("owner");
    render(<NoteComments note={alone} />, host);
    await tick();
    expect(host.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says how many there are, and opens onto them", async () => {
    stored = [
      comment(),
      comment({ id: "c2", author: null, body: "I was here" }),
    ];
    await show(sharedNote("edit"), alice);
    expect(toggle()?.textContent).toBe(plural("comments.count", 2));
    expect(rows()).toEqual([]);

    await open();
    expect(rows()[0]).toContain("Olivia");
    expect(rows()[0]).toContain("Shall we take the train?");
    // Someone no longer on the note: the words stay, the name does not.
    expect(rows()[1]).toContain(t("comments.formerParticipant"));
    expect(rows()[1]).toContain("I was here");
  });

  it("adds a comment and empties the field", async () => {
    await show(sharedNote("view"), alice);
    expect(toggle()?.textContent).toBe(t("comments.none"));
    await open();
    const field = labelled(t("comments.placeholder")) as HTMLTextAreaElement;
    type(field, "  Yes please  ");
    await tick();
    host.querySelector("form")?.requestSubmit();

    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toContain("Yes please");
    expect(requests.at(-1)).toEqual({
      method: "POST",
      path: "/notes/n1/comments",
      body: { body: "Yes please" },
    });
    expect(field.value).toBe("");
    expect(toggle()?.textContent).toBe(plural("comments.count", 1));
  });

  it("lets the author edit their own, and shows it as edited", async () => {
    stored = [
      comment({ author: alice, body: "Bokked" }),
      comment({ id: "c2" }),
    ];
    await show(sharedNote("edit"), alice);
    await open();
    // One edit button: the other comment is Olivia's.
    expect(
      host.querySelectorAll(`[aria-label="${t("comments.edit")}"]`),
    ).toHaveLength(1);
    labelled(t("comments.edit"))?.click();
    const field = await vi.waitFor(() => {
      const el = labelled(t("comments.editLabel"));
      expect(el).toBeTruthy();
      return el as HTMLTextAreaElement;
    });
    expect(field.value).toBe("Bokked");
    type(field, "Booked");
    await tick();
    field.closest("form")?.requestSubmit();

    await vi.waitFor(() => expect(rows()[0]).toContain("Booked"));
    expect(rows()[0]).toContain(t("comments.edited"));
    expect(labelled(t("comments.editLabel"))).toBeNull();
  });

  it("deletes after asking, one's own or as the note's owner any", async () => {
    stored = [
      comment({ author: alice, body: "Not mine" }),
      comment({ id: "c2", author: null }),
    ];
    await show(sharedNote("owner"), olivia);
    await open();
    const deletes = host.querySelectorAll<HTMLElement>(
      `[aria-label="${t("comments.delete")}"]`,
    );
    expect(deletes).toHaveLength(2);
    // The owner cannot edit what someone else wrote.
    expect(labelled(t("comments.edit"))).toBeNull();

    deletes[0]?.click();
    await vi.waitFor(() => expect(confirmRequest.value).not.toBeNull());
    answerConfirmation(true);
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(requests.at(-1)).toMatchObject({
      method: "DELETE",
      path: "/notes/n1/comments/c1",
    });
  });

  it("offers a recipient no delete on someone else's comment", async () => {
    stored = [comment()];
    await show(sharedNote("edit"), alice);
    await open();
    expect(labelled(t("comments.delete"))).toBeNull();
  });

  it("takes in what the socket reports while open", async () => {
    await show(sharedNote("edit"), alice);
    await open();
    receiveComment(comment());
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    receiveComment(comment({ body: "By bus, then" }));
    await vi.waitFor(() => expect(rows()[0]).toContain("By bus, then"));
    forgetComment("n1", "c1");
    await vi.waitFor(() => expect(rows()).toHaveLength(0));
  });

  it("keeps nothing for a note whose panel is gone", async () => {
    await show(sharedNote("edit"), alice);
    await close();
    expect(noteComments.value.has("n1")).toBe(false);
    receiveComment(comment());
    expect(noteComments.value.has("n1")).toBe(false);
  });

  it("says a failed load and reads again when asked", async () => {
    nextRead = async () => json({ error: "no" }, 500);
    stored = [comment()];
    vi.spyOn(console, "error").mockImplementation(() => {});
    currentUser.value = { ...alice, email: null, isAdmin: false };
    render(<NoteComments note={sharedNote("edit")} />, host);
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("comments.loadFailed")),
    );

    // No line to open while there is nothing to open onto.
    expect(toggle()).toBeNull();
    retry()?.click();
    await vi.waitFor(() =>
      expect(toggle()?.textContent).toBe(plural("comments.count", 1)),
    );
    expect(host.textContent).not.toContain(t("comments.loadFailed"));
  });

  it("drops an answer that arrives after the panel is gone", async () => {
    let answer: (res: Response) => void = () => {};
    nextRead = () => new Promise((resolve) => (answer = resolve));
    render(<NoteComments note={sharedNote("edit")} />, host);
    await vi.waitFor(() => expect(reads()).toBe(1));
    render(null, host);
    answer(json({ comments: [comment()] }));
    await tick();
    await tick();
    expect(noteComments.value.has("n1")).toBe(false);
  });

  it("reads again when an event arrives during a load", async () => {
    let answer: (res: Response) => void = () => {};
    nextRead = () => new Promise((resolve) => (answer = resolve));
    render(<NoteComments note={sharedNote("edit")} />, host);
    await vi.waitFor(() => expect(reads()).toBe(1));

    // Written after the server read the list the first answer carries.
    stored = [comment()];
    receiveComment(comment());
    answer(json({ comments: [] }));
    await vi.waitFor(() =>
      expect(noteComments.value.get("n1")).toHaveLength(1),
    );
    await tick();
    expect(noteComments.value.get("n1")).toHaveLength(1);
    expect(reads()).toBe(2);
  });

  it("catches up after a gap in the socket, for an open panel only", async () => {
    reloadComments();
    expect(reads()).toBe(0);

    await show(sharedNote("edit"), alice);
    stored = [comment()];
    reloadComments();
    await vi.waitFor(() =>
      expect(toggle()?.textContent).toBe(plural("comments.count", 1)),
    );

    await close();
    reloadComments();
    expect(reads()).toBe(2);
  });

  it("reads again when the people on the note change", async () => {
    stored = [comment({ author: alice })];
    await show(sharedNote("owner"), olivia);
    await open();
    expect(rows()[0]).toContain("Alice");

    // Alice is removed: the server now leaves her name off.
    stored = [comment({ author: null })];
    const note = sharedNote("owner");
    render(
      <NoteComments
        note={{
          ...note,
          sharing: { role: "owner", owner: olivia, members: [] },
        }}
      />,
      host,
    );
    await vi.waitFor(() =>
      expect(rows()[0]).toContain(t("comments.formerParticipant")),
    );
    expect(reads()).toBe(2);

    // Anything else about the note changing reads nothing.
    render(
      <NoteComments
        note={{
          ...note,
          title: "Trip!",
          sharing: { role: "owner", owner: olivia, members: [] },
        }}
      />,
      host,
    );
    await tick();
    expect(reads()).toBe(2);
  });
});
