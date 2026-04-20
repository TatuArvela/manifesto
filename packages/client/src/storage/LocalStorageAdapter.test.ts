import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageAdapter } from "./LocalStorageAdapter.js";

const STORAGE_KEY = "manifesto:notes";

describe("LocalStorageAdapter", () => {
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    localStorage.clear();
    adapter = new LocalStorageAdapter();
  });

  afterEach(() => {
    localStorage.clear();
  });

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
    tags: ["test"],
    images: [],
  };

  it("creates and retrieves a note", async () => {
    const note = await adapter.create(sampleNote);
    expect(note.id).toBeTruthy();
    expect(note.title).toBe("Test");
    expect(note.content).toBe("Hello");
    expect(note.createdAt).toBeTruthy();
    expect(note.updatedAt).toBeTruthy();
    expect(note.tags).toEqual(["test"]);

    const fetched = await adapter.get(note.id);
    expect(fetched).toEqual(note);
  });

  it("getAll returns all notes", async () => {
    await adapter.create(sampleNote);
    await adapter.create({ ...sampleNote, title: "Second" });
    const all = await adapter.getAll();
    expect(all).toHaveLength(2);
  });

  it("updates a note", async () => {
    const note = await adapter.create(sampleNote);
    const updated = await adapter.update(note.id, { title: "Updated" });
    expect(updated.title).toBe("Updated");
    expect(updated.content).toBe("Hello");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(note.updatedAt).getTime(),
    );
  });

  it("update throws for missing note", async () => {
    await expect(adapter.update("nonexistent", { title: "X" })).rejects.toThrow(
      "Note not found: nonexistent",
    );
  });

  it("deletes a note", async () => {
    const note = await adapter.create(sampleNote);
    await adapter.delete(note.id);
    const all = await adapter.getAll();
    expect(all).toHaveLength(0);
  });

  it("deleteAll removes everything", async () => {
    await adapter.create(sampleNote);
    await adapter.create({ ...sampleNote, title: "B" });
    await adapter.deleteAll();
    expect(await adapter.getAll()).toHaveLength(0);
  });

  it("search finds by title", async () => {
    await adapter.create({ ...sampleNote, title: "Alpha" });
    await adapter.create({ ...sampleNote, title: "Beta" });
    const results = await adapter.search("alpha");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Alpha");
  });

  it("search finds by content", async () => {
    await adapter.create({ ...sampleNote, content: "important stuff" });
    await adapter.create({ ...sampleNote, content: "nothing here" });
    const results = await adapter.search("important");
    expect(results).toHaveLength(1);
  });

  it("importAll merges by id", async () => {
    const note = await adapter.create(sampleNote);
    const imported = { ...note, title: "Imported Title" };
    await adapter.importAll([imported]);
    const all = await adapter.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Imported Title");
  });

  it("importAll adds new notes", async () => {
    await adapter.create(sampleNote);
    const newNote = {
      id: "new-id",
      title: "New",
      content: "",
      color: NoteColor.Blue,
      font: NoteFont.Default,
      pinned: false,
      archived: false,
      trashed: false,
      trashedAt: null,
      position: 1,
      tags: [],
      images: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await adapter.importAll([newNote]);
    const all = await adapter.getAll();
    expect(all).toHaveLength(2);
  });

  it("migrates notes without font field", async () => {
    const oldNote = {
      id: "old",
      title: "Old",
      content: "",
      color: NoteColor.Default,
      pinned: false,
      archived: false,
      trashed: false,
      trashedAt: null,
      position: 0,
      tags: [],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([oldNote]));
    const freshAdapter = new LocalStorageAdapter();
    const notes = await freshAdapter.getAll();
    expect(notes[0].font).toBe(NoteFont.Default);
  });

  it("handles corrupted localStorage gracefully", async () => {
    localStorage.setItem(STORAGE_KEY, "not json");
    const freshAdapter = new LocalStorageAdapter();
    const notes = await freshAdapter.getAll();
    expect(notes).toEqual([]);
  });
});
