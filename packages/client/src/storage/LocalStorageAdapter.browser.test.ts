import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LocalStorageAdapter,
  subscribeToExternalNotes,
} from "./LocalStorageAdapter.js";
import { quotaRefusedAt } from "./quota.js";

const STORAGE_KEY = "manifesto:notes";

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
  linkPreviews: [],
  reminder: null,
};

describe("LocalStorageAdapter", () => {
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    localStorage.clear();
    adapter = new LocalStorageAdapter();
  });

  afterEach(() => {
    localStorage.clear();
  });

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
      linkPreviews: [],
      reminder: null,
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

  it("reports a refusal and does not throw when localStorage is full", async () => {
    // The refusal is reported as a fact, not as a toast: this layer has no
    // message catalogue and no toast queue, and `actions.ts` decides what the
    // user is told. The message itself is covered in `actions.browser.test.ts`.
    quotaRefusedAt.value = 0;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });
    try {
      // Must not throw: the caller's try/catch isn't responsible for storage
      // failure, and the note stays on screen for the rest of the session.
      await expect(adapter.create(sampleNote)).resolves.toBeDefined();
      expect(quotaRefusedAt.value).toBeGreaterThan(0);
    } finally {
      setItem.mockRestore();
      quotaRefusedAt.value = 0;
    }
  });
});

describe("cross-tab note changes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  /** What the browser delivers to the *other* tabs after a write. */
  function otherTabWrote(notes: unknown[]) {
    const value = JSON.stringify(notes);
    localStorage.setItem(STORAGE_KEY, value);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: value,
        storageArea: localStorage,
      }),
    );
  }

  it("reports the list another tab wrote", async () => {
    // Every tab holds the whole list and writes all of it back on any edit, so
    // without hearing this a tab puts its stale copy back: trash a note in one
    // tab, change anything in another, and the trashed note returns.
    const adapter = new LocalStorageAdapter();
    const kept = await adapter.create({ ...sampleNote, title: "Kept" });
    const trashed = await adapter.create({ ...sampleNote, title: "Trashed" });

    const seen: Note[][] = [];
    const stop = subscribeToExternalNotes((notes) => seen.push(notes));
    try {
      otherTabWrote([{ ...trashed, trashed: true }, kept]);
    } finally {
      stop();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].find((n) => n.id === trashed.id)?.trashed).toBe(true);
  });

  it("reports an empty list when the whole store is cleared", () => {
    const seen: Note[][] = [];
    const stop = subscribeToExternalNotes((notes) => seen.push(notes));
    try {
      // `localStorage.clear()` in another tab arrives with a null key.
      window.dispatchEvent(
        new StorageEvent("storage", { key: null, storageArea: localStorage }),
      );
    } finally {
      stop();
    }

    expect(seen).toEqual([[]]);
  });

  it("ignores writes to other keys", () => {
    const seen: Note[][] = [];
    const stop = subscribeToExternalNotes((notes) => seen.push(notes));
    try {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "manifesto:prefs",
          newValue: "{}",
          storageArea: localStorage,
        }),
      );
    } finally {
      stop();
    }

    expect(seen).toEqual([]);
  });

  it("stops reporting once unsubscribed", () => {
    const seen: Note[][] = [];
    subscribeToExternalNotes((notes) => seen.push(notes))();
    otherTabWrote([]);
    expect(seen).toEqual([]);
  });
});
