import { NoteColor } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addTagToNotes,
  bulkAddTag,
  bulkArchive,
  bulkDelete,
  bulkPin,
  bulkSetColor,
  bulkTrash,
  createNote,
  deleteTag,
  enterSelectMode,
  exitSelectMode,
  notes,
  permanentlyDeleteNote,
  reorderNotes,
  toggleSelectNote,
} from "./actions.js";
import { sortMode } from "./prefs.js";
import { activeView, searchQuery, selectedNotes, selectMode } from "./ui.js";

describe("selection mode", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    activeView.value = "active";
    searchQuery.value = "";
    sortMode.value = "default";
    selectMode.value = false;
    selectedNotes.value = new Set();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("enterSelectMode activates select mode", async () => {
    const note = await createNote({ title: "A" });
    enterSelectMode(note.id);
    expect(selectMode.value).toBe(true);
    expect(selectedNotes.value.has(note.id)).toBe(true);
  });

  it("enterSelectMode without id starts with empty selection", () => {
    enterSelectMode();
    expect(selectMode.value).toBe(true);
    expect(selectedNotes.value.size).toBe(0);
  });

  it("exitSelectMode clears selection", async () => {
    const note = await createNote({ title: "A" });
    enterSelectMode(note.id);
    exitSelectMode();
    expect(selectMode.value).toBe(false);
    expect(selectedNotes.value.size).toBe(0);
  });

  it("toggleSelectNote adds and removes notes", async () => {
    const n1 = await createNote({ title: "A" });
    const n2 = await createNote({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    expect(selectedNotes.value.size).toBe(2);
    toggleSelectNote(n1.id);
    expect(selectedNotes.value.size).toBe(1);
    expect(selectedNotes.value.has(n2.id)).toBe(true);
  });

  it("toggleSelectNote exits select mode when last note deselected", async () => {
    const note = await createNote({ title: "A" });
    enterSelectMode(note.id);
    toggleSelectNote(note.id);
    expect(selectMode.value).toBe(false);
  });
});

describe("bulk operations", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    activeView.value = "active";
    searchQuery.value = "";
    sortMode.value = "default";
    selectMode.value = false;
    selectedNotes.value = new Set();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("bulkPin pins all selected notes", async () => {
    const n1 = await createNote({ title: "A" });
    const n2 = await createNote({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkPin();
    expect(notes.value.every((n) => n.pinned)).toBe(true);
    expect(selectMode.value).toBe(false);
  });

  it("bulkPin unpins when all are already pinned", async () => {
    const n1 = await createNote({ title: "A", pinned: true });
    const n2 = await createNote({ title: "B", pinned: true });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkPin();
    expect(notes.value.every((n) => !n.pinned)).toBe(true);
  });

  it("bulkArchive archives all selected notes", async () => {
    const n1 = await createNote({ title: "A" });
    const n2 = await createNote({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkArchive();
    expect(notes.value.every((n) => n.archived)).toBe(true);
    expect(selectMode.value).toBe(false);
  });

  it("bulkTrash trashes all selected notes", async () => {
    const n1 = await createNote({ title: "A" });
    const n2 = await createNote({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkTrash();
    expect(notes.value.every((n) => n.trashed)).toBe(true);
  });

  it("bulkDelete permanently deletes all selected notes", async () => {
    const n1 = await createNote({ title: "A" });
    const n2 = await createNote({ title: "B" });
    await createNote({ title: "C" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkDelete();
    expect(notes.value).toHaveLength(1);
    expect(notes.value[0].title).toBe("C");
  });

  it("bulkSetColor changes color of all selected notes", async () => {
    const n1 = await createNote({ title: "A" });
    const n2 = await createNote({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkSetColor(NoteColor.Blue);
    expect(notes.value.every((n) => n.color === NoteColor.Blue)).toBe(true);
  });

  it("bulkAddTag adds tag to all selected notes", async () => {
    const n1 = await createNote({ title: "A" });
    const n2 = await createNote({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkAddTag("test");
    expect(notes.value.every((n) => n.tags.includes("test"))).toBe(true);
  });

  it("bulk operations skip deleted notes gracefully", async () => {
    const n1 = await createNote({ title: "A" });
    const n2 = await createNote({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    // Delete n1 before bulk operation runs
    await permanentlyDeleteNote(n1.id);
    // Should not throw
    await bulkArchive();
    expect(notes.value).toHaveLength(1);
    expect(notes.value[0].archived).toBe(true);
  });
});

describe("tag operations", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    activeView.value = "active";
    searchQuery.value = "";
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("addTagToNotes adds tag to specified notes", async () => {
    const n1 = await createNote({ title: "A" });
    const n2 = await createNote({ title: "B" });
    await addTagToNotes("work", new Set([n1.id, n2.id]));
    expect(notes.value[0].tags).toContain("work");
    expect(notes.value[1].tags).toContain("work");
  });

  it("addTagToNotes does not duplicate existing tag", async () => {
    const n1 = await createNote({ title: "A", tags: ["work"] });
    await addTagToNotes("work", new Set([n1.id]));
    expect(notes.value[0].tags.filter((t) => t === "work")).toHaveLength(1);
  });

  it("deleteTag removes tag from all notes", async () => {
    await createNote({ title: "A", tags: ["work", "personal"] });
    await createNote({ title: "B", tags: ["work"] });
    await deleteTag("work");
    expect(notes.value[0].tags).toEqual(["personal"]);
    expect(notes.value[1].tags).toEqual([]);
  });
});

describe("reorderNotes", () => {
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

  it("reorders notes by updating positions", async () => {
    const n1 = await createNote({ title: "A", position: 0 });
    const n2 = await createNote({ title: "B", position: 1 });
    const n3 = await createNote({ title: "C", position: 2 });
    // Move A from index 0 to index 2
    await reorderNotes([n1.id, n2.id, n3.id], 0, 2);
    const sorted = [...notes.value].sort((a, b) => a.position - b.position);
    expect(sorted.map((n) => n.title)).toEqual(["B", "C", "A"]);
  });

  it("reorderNotes is a no-op when fromIndex === toIndex", async () => {
    const n1 = await createNote({ title: "A", position: 0 });
    const n2 = await createNote({ title: "B", position: 1 });
    await reorderNotes([n1.id, n2.id], 0, 0);
    // Positions unchanged
    expect(notes.value.find((n) => n.id === n1.id)?.position).toBe(0);
    expect(notes.value.find((n) => n.id === n2.id)?.position).toBe(1);
  });
});
