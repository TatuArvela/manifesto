import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveNote,
  createNote,
  expireTrash,
  filteredNotes,
  loadNotes,
  notes,
  permanentlyDeleteNote,
  restoreNote,
  sortedNotes,
  toggleCheckbox,
  togglePin,
  trashNote,
  unarchiveNote,
  updateNote,
} from "./actions.js";
import { sortMode } from "./prefs.js";
import { activeView, searchQuery } from "./ui.js";

describe("state actions", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    activeView.value = "active";
    searchQuery.value = "";
    sortMode.value = "default";
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("createNote adds a note to state and storage", async () => {
    const note = await createNote({ title: "Hello" });
    expect(note.title).toBe("Hello");
    expect(notes.value).toHaveLength(1);
    expect(notes.value[0].id).toBe(note.id);
  });

  it("updateNote modifies a note", async () => {
    const note = await createNote({ title: "Original" });
    await updateNote(note.id, { title: "Updated" });
    expect(notes.value[0].title).toBe("Updated");
  });

  it("updateNote throws for nonexistent note", async () => {
    await expect(updateNote("fake", { title: "X" })).rejects.toThrow();
  });

  it("permanentlyDeleteNote removes from state", async () => {
    const note = await createNote({ title: "Delete me" });
    await permanentlyDeleteNote(note.id);
    expect(notes.value).toHaveLength(0);
  });

  it("trashNote sets trashed flag", async () => {
    const note = await createNote({ title: "Trash me" });
    await trashNote(note.id);
    expect(notes.value[0].trashed).toBe(true);
    expect(notes.value[0].trashedAt).toBeTruthy();
    expect(notes.value[0].archived).toBe(false);
  });

  it("restoreNote clears trashed flag", async () => {
    const note = await createNote({ title: "Restore me" });
    await trashNote(note.id);
    await restoreNote(note.id);
    expect(notes.value[0].trashed).toBe(false);
    expect(notes.value[0].trashedAt).toBeNull();
  });

  it("archiveNote and unarchiveNote toggle archived", async () => {
    const note = await createNote({ title: "Archive" });
    await archiveNote(note.id);
    expect(notes.value[0].archived).toBe(true);
    await unarchiveNote(note.id);
    expect(notes.value[0].archived).toBe(false);
  });

  it("togglePin flips the pinned flag", async () => {
    const note = await createNote({ title: "Pin me" });
    expect(notes.value[0].pinned).toBe(false);
    await togglePin(note.id);
    expect(notes.value[0].pinned).toBe(true);
    await togglePin(note.id);
    expect(notes.value[0].pinned).toBe(false);
  });

  it("toggleCheckbox flips checkbox state", async () => {
    const note = await createNote({ content: "- [ ] A\n- [x] B" });
    await toggleCheckbox(note.id, 0);
    expect(notes.value[0].content).toBe("- [x] A\n- [x] B");
    await toggleCheckbox(note.id, 1);
    expect(notes.value[0].content).toBe("- [x] A\n- [ ] B");
  });

  it("loadNotes reads from storage", async () => {
    await createNote({ title: "Persisted" });
    notes.value = [];
    expect(notes.value).toHaveLength(0);
    await loadNotes();
    expect(notes.value).toHaveLength(1);
    expect(notes.value[0].title).toBe("Persisted");
  });
});

describe("filteredNotes", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    activeView.value = "active";
    searchQuery.value = "";
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("active view hides archived and trashed notes", async () => {
    await createNote({ title: "Active" });
    await createNote({ title: "Archived", archived: true });
    await createNote({ title: "Trashed", trashed: true });
    activeView.value = "active";
    expect(filteredNotes.value).toHaveLength(1);
    expect(filteredNotes.value[0].title).toBe("Active");
  });

  it("trash view shows only trashed notes", async () => {
    await createNote({ title: "Active" });
    const trashed = await createNote({ title: "Trashed" });
    await trashNote(trashed.id);
    activeView.value = "trash";
    expect(filteredNotes.value).toHaveLength(1);
    expect(filteredNotes.value[0].title).toBe("Trashed");
  });

  it("archived view shows only archived (not trashed)", async () => {
    const n1 = await createNote({ title: "Archived" });
    await archiveNote(n1.id);
    const n2 = await createNote({ title: "Both" });
    await archiveNote(n2.id);
    await trashNote(n2.id);
    activeView.value = "archived";
    expect(filteredNotes.value).toHaveLength(1);
    expect(filteredNotes.value[0].title).toBe("Archived");
  });

  it("search filters by title and content", async () => {
    await createNote({ title: "Grocery list" });
    await createNote({ title: "Code review", content: "check groceries" });
    await createNote({ title: "Random" });
    searchQuery.value = "grocer";
    expect(filteredNotes.value).toHaveLength(2);
  });
});

describe("sortedNotes", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    activeView.value = "active";
    searchQuery.value = "";
    sortMode.value = "default";
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("default sort by position", async () => {
    await createNote({ title: "C", position: 3 });
    await createNote({ title: "A", position: 1 });
    await createNote({ title: "B", position: 2 });
    sortMode.value = "default";
    expect(sortedNotes.value.map((n) => n.title)).toEqual(["A", "B", "C"]);
  });

  it("sort by created (newest first)", async () => {
    await createNote({ title: "First" });
    await new Promise((r) => setTimeout(r, 5));
    await createNote({ title: "Second" });
    sortMode.value = "created";
    expect(sortedNotes.value[0].title).toBe("Second");
  });
});

describe("expireTrash", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("deletes notes trashed more than 30 days ago", async () => {
    const oldDate = new Date(
      Date.now() - 31 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await createNote({
      title: "Old trashed",
      trashed: true,
      trashedAt: oldDate,
    });
    await createNote({ title: "Recent trashed", trashed: true });
    await createNote({ title: "Active" });

    await expireTrash();
    expect(notes.value).toHaveLength(2);
    expect(notes.value.map((n) => n.title).sort()).toEqual([
      "Active",
      "Recent trashed",
    ]);
  });

  it("does not delete recently trashed notes", async () => {
    await createNote({
      title: "Recent",
      trashed: true,
      trashedAt: new Date().toISOString(),
    });
    await expireTrash();
    expect(notes.value).toHaveLength(1);
  });
});
