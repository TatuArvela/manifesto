import {
  NewerNoteFormatError,
  NoteColor,
  NoteFont,
  setNoteFormatStepsForTests,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageAdapter } from "./LocalStorageAdapter.ts";
import { getVersions } from "./VersionStorage.ts";

/**
 * The format of the open-mode store (`noteFormat.ts` in shared): one for the
 * notes and their versions together, recorded next to them, updated one time
 * when the code reads an older one, and never read or written by an older
 * build.
 */

const NOTES_KEY = "manifesto:notes";
const FORMAT_KEY = "manifesto:notes:format";

const sampleNote = {
  title: "Test",
  content: "Hello",
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

/** Format 2 while it is set: each title in capitals. */
const shout = (words: { title?: string }) =>
  words.title === undefined ? {} : { title: words.title.toUpperCase() };

describe("LocalStorageAdapter's format", () => {
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    localStorage.clear();
    adapter = new LocalStorageAdapter();
  });

  afterEach(() => {
    setNoteFormatStepsForTests(null);
    localStorage.clear();
  });

  it("records the format with every write", async () => {
    await adapter.create(sampleNote);
    expect(localStorage.getItem(FORMAT_KEY)).toBe("1");
  });

  it("reads a store from before formats as format 1", async () => {
    const note = await adapter.create(sampleNote);
    localStorage.removeItem(FORMAT_KEY);
    expect((await adapter.getAll()).map((n) => n.id)).toEqual([note.id]);
  });

  it("brings an older store's notes and versions up to date, once", async () => {
    const note = await adapter.create(sampleNote);
    await adapter.saveVersion(note.id, { title: "Earlier", content: "" });

    setNoteFormatStepsForTests([shout]);
    expect((await adapter.getAll()).map((n) => n.title)).toEqual(["TEST"]);
    expect(getVersions(note.id).map((v) => v.title)).toEqual(["EARLIER"]);
    expect(localStorage.getItem(FORMAT_KEY)).toBe("2");
    // Written back: a second read has nothing left to change.
    expect(localStorage.getItem(NOTES_KEY)).toContain('"TEST"');
    expect((await adapter.get(note.id))?.title).toBe("TEST");
  });

  it("neither reads nor writes a store a newer build wrote", async () => {
    setNoteFormatStepsForTests([shout]);
    const note = await adapter.create(sampleNote);
    setNoteFormatStepsForTests(null);
    const before = localStorage.getItem(NOTES_KEY);

    await expect(adapter.getAll()).rejects.toBeInstanceOf(NewerNoteFormatError);
    await expect(
      adapter.update(note.id, { title: "From before" }),
    ).rejects.toBeInstanceOf(NewerNoteFormatError);
    await expect(adapter.create(sampleNote)).rejects.toBeInstanceOf(
      NewerNoteFormatError,
    );
    await expect(adapter.deleteAll()).rejects.toBeInstanceOf(
      NewerNoteFormatError,
    );
    expect(localStorage.getItem(NOTES_KEY)).toBe(before);
    expect(localStorage.getItem(FORMAT_KEY)).toBe("2");
  });
});
