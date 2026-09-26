import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentUser } from "../state/auth.js";
import { shareDialog } from "../state/sharing.js";
import { SharedPeople } from "./SharedAvatars.js";

let host: HTMLDivElement;

const alice = {
  id: "alice",
  username: "alice",
  displayName: "Alice",
  avatarColor: "#f00",
};
const bob = {
  id: "bob",
  username: "bob",
  displayName: "Bob",
  avatarColor: "#0f0",
};
const cleo = {
  id: "cleo",
  username: "cleo",
  displayName: "",
  avatarColor: "#00f",
};

function sharedNote(): Note {
  return {
    id: "note",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sharing: {
      role: "owner",
      owner: alice,
      members: [
        { ...bob, role: "edit", accepted: true },
        { ...cleo, role: "view", accepted: false },
      ],
    },
  };
}

beforeEach(() => {
  currentUser.value = { ...alice, email: null, isAdmin: false };
  shareDialog.value = null;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  currentUser.value = null;
  shareDialog.value = null;
});

describe("the people on an open note", () => {
  it("names whoever the owner shared it with, and who has yet to accept", () => {
    render(<SharedPeople note={sharedNote()} />, host);
    const text = host.textContent ?? "";
    expect(text).toContain("Bob");
    expect(text).toContain("cleo");
    expect(text).not.toContain("Alice");
  });

  it("opens the share dialog for the note", () => {
    render(<SharedPeople note={sharedNote()} />, host);
    host.querySelector("button")?.click();
    expect(shareDialog.value).toEqual({ noteId: "note" });
  });

  it("shows nothing on a note shared with nobody else", () => {
    render(
      <SharedPeople note={{ ...sharedNote(), sharing: undefined }} />,
      host,
    );
    expect(host.childElementCount).toBe(0);
  });
});
