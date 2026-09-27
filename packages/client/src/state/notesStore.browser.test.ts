import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, describe, expect, it } from "vitest";
import { storageConnection } from "../storage/index.js";
import { notes, notesLoaded } from "./notesStore.js";

const note: Note = {
  id: "n1",
  title: "Diary",
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
};

afterEach(() => {
  storageConnection.value = { serverUrl: null, token: null };
  notes.value = [];
  notesLoaded.value = false;
});

describe("the end of a session", () => {
  it("takes the account's notes out of memory", () => {
    storageConnection.value = { serverUrl: "http://server.test", token: "t" };
    notes.value = [note];
    notesLoaded.value = true;
    storageConnection.value = { serverUrl: "http://server.test", token: null };
    expect(notes.value).toEqual([]);
    expect(notesLoaded.value).toBe(false);
  });

  it("leaves open mode's notes alone, which have no session", () => {
    notes.value = [note];
    storageConnection.value = { serverUrl: null, token: null };
    expect(notes.value).toEqual([note]);
  });
});
