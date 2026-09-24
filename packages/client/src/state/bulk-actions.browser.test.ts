import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { plural } from "../i18n/index.js";
import {
  addTagToNotes,
  bulkAddTag,
  bulkArchive,
  bulkDelete,
  bulkPin,
  bulkSetColor,
  bulkTrash,
  deleteTag,
  permanentlyDeleteNote,
  renameTag,
  reorderNotes,
} from "./actions.js";
import { asBatch } from "./failures.js";
import { notes, updateNote } from "./notesStore.js";
import { hiddenTags, sortMode } from "./prefs.js";
import {
  enterSelectMode,
  exitSelectMode,
  toggleSelectNote,
} from "./selection.js";
import { createNoteOrFail } from "./testSupport.js";
import {
  activeView,
  searchQuery,
  selectedNotes,
  selectMode,
  toasts,
} from "./ui.js";
import {
  notesHiddenByTag,
  setTagHidden,
  sortedNotes,
  tagCounts,
} from "./views.js";

const baseNote: Note = {
  id: "",
  title: "Phantom",
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
};

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
    const note = await createNoteOrFail({ title: "A" });
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
    const note = await createNoteOrFail({ title: "A" });
    enterSelectMode(note.id);
    exitSelectMode();
    expect(selectMode.value).toBe(false);
    expect(selectedNotes.value.size).toBe(0);
  });

  it("toggleSelectNote adds and removes notes", async () => {
    const n1 = await createNoteOrFail({ title: "A" });
    const n2 = await createNoteOrFail({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    expect(selectedNotes.value.size).toBe(2);
    toggleSelectNote(n1.id);
    expect(selectedNotes.value.size).toBe(1);
    expect(selectedNotes.value.has(n2.id)).toBe(true);
  });

  it("toggleSelectNote exits select mode when last note deselected", async () => {
    const note = await createNoteOrFail({ title: "A" });
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
    const n1 = await createNoteOrFail({ title: "A" });
    const n2 = await createNoteOrFail({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkPin();
    expect(notes.value.every((n) => n.pinned)).toBe(true);
    expect(selectMode.value).toBe(false);
  });

  it("bulkPin puts the notes at the head of the pinned ones, in their order", async () => {
    const a = await createNoteOrFail({ title: "A" });
    const b = await createNoteOrFail({ title: "B" });
    await createNoteOrFail({ title: "Pinned", pinned: true });
    enterSelectMode(a.id);
    toggleSelectNote(b.id);
    await bulkPin();
    expect(sortedNotes.value.map((n) => n.title)).toEqual(["B", "A", "Pinned"]);
  });

  it("bulkPin unpins when all are already pinned", async () => {
    const n1 = await createNoteOrFail({ title: "A", pinned: true });
    const n2 = await createNoteOrFail({ title: "B", pinned: true });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkPin();
    expect(notes.value.every((n) => !n.pinned)).toBe(true);
  });

  it("bulkArchive archives all selected notes", async () => {
    const n1 = await createNoteOrFail({ title: "A" });
    const n2 = await createNoteOrFail({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkArchive();
    expect(notes.value.every((n) => n.archived)).toBe(true);
    expect(selectMode.value).toBe(false);
  });

  it("bulkTrash trashes all selected notes", async () => {
    const n1 = await createNoteOrFail({ title: "A" });
    const n2 = await createNoteOrFail({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkTrash();
    expect(notes.value.every((n) => n.trashed)).toBe(true);
  });

  it("bulkDelete permanently deletes all selected notes", async () => {
    const n1 = await createNoteOrFail({ title: "A" });
    const n2 = await createNoteOrFail({ title: "B" });
    await createNoteOrFail({ title: "C" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkDelete();
    expect(notes.value).toHaveLength(1);
    expect(notes.value[0].title).toBe("C");
  });

  it("bulkSetColor changes color of all selected notes", async () => {
    const n1 = await createNoteOrFail({ title: "A" });
    const n2 = await createNoteOrFail({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkSetColor(NoteColor.Blue);
    expect(notes.value.every((n) => n.color === NoteColor.Blue)).toBe(true);
  });

  it("bulkAddTag adds tag to all selected notes", async () => {
    const n1 = await createNoteOrFail({ title: "A" });
    const n2 = await createNoteOrFail({ title: "B" });
    enterSelectMode(n1.id);
    toggleSelectNote(n2.id);
    await bulkAddTag("test");
    expect(notes.value.every((n) => n.tags.includes("test"))).toBe(true);
  });

  it("bulk operations skip deleted notes gracefully", async () => {
    const n1 = await createNoteOrFail({ title: "A" });
    const n2 = await createNoteOrFail({ title: "B" });
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
    const n1 = await createNoteOrFail({ title: "A" });
    const n2 = await createNoteOrFail({ title: "B" });
    await addTagToNotes("work", new Set([n1.id, n2.id]));
    expect(notes.value[0].tags).toContain("work");
    expect(notes.value[1].tags).toContain("work");
  });

  it("addTagToNotes does not duplicate existing tag", async () => {
    const n1 = await createNoteOrFail({ title: "A", tags: ["work"] });
    await addTagToNotes("work", new Set([n1.id]));
    expect(notes.value[0].tags.filter((t) => t === "work")).toHaveLength(1);
  });

  it("deleteTag removes tag from all notes", async () => {
    await createNoteOrFail({ title: "A", tags: ["work", "personal"] });
    await createNoteOrFail({ title: "B", tags: ["work"] });
    await deleteTag("work");
    expect(notes.value[0].tags).toEqual(["personal"]);
    expect(notes.value[1].tags).toEqual([]);
  });

  it("deleteTag stops hiding the tag it deleted", async () => {
    await createNoteOrFail({ title: "A", tags: ["work"] });
    setTagHidden("work", true);
    await deleteTag("work");
    expect(hiddenTags.value).toEqual([]);
  });

  it("renameTag renames the tag on every note, merging into one it meets", async () => {
    await createNoteOrFail({ title: "A", tags: ["wrok", "home"] });
    await createNoteOrFail({ title: "B", tags: ["wrok", "work"] });
    await createNoteOrFail({ title: "C", tags: ["home"] });
    await renameTag("wrok", "work");
    const tagsOf = (title: string) =>
      notes.value.find((n) => n.title === title)?.tags;
    expect(tagsOf("A")).toEqual(["work", "home"]);
    expect(tagsOf("B")).toEqual(["work"]);
    expect(tagsOf("C")).toEqual(["home"]);
    expect(tagCounts.value.get("work")).toBe(2);
    expect(tagCounts.value.has("wrok")).toBe(false);
  });

  it("renameTag keeps a hidden tag hidden under its new name", async () => {
    await createNoteOrFail({ title: "A", tags: ["old"] });
    setTagHidden("old", true);
    await renameTag("old", "new");
    expect(hiddenTags.value).toEqual(["new"]);
  });
});

describe("hidden tags", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    hiddenTags.value = [];
    activeView.value = "active";
    searchQuery.value = "";
    sortMode.value = "default";
  });

  afterEach(() => {
    hiddenTags.value = [];
    localStorage.clear();
  });

  const titles = () => sortedNotes.value.map((n) => n.title).sort();

  it("keeps a hidden tag's notes out of the Notes view only", async () => {
    await createNoteOrFail({ title: "Work", tags: ["work"] });
    await createNoteOrFail({ title: "Both", tags: ["home", "work"] });
    await createNoteOrFail({ title: "Home", tags: ["home"] });
    await createNoteOrFail({
      title: "Old work",
      tags: ["work"],
      archived: true,
    });
    setTagHidden("work", true);

    expect(titles()).toEqual(["Home"]);
    // Only notes the Notes view would otherwise show count as hidden.
    expect(notesHiddenByTag.value).toBe(2);

    activeView.value = "tags";
    expect(titles()).toEqual(["Both", "Home", "Work"]);
    activeView.value = "archived";
    expect(titles()).toEqual(["Old work"]);

    activeView.value = "active";
    setTagHidden("work", false);
    expect(titles()).toEqual(["Both", "Home", "Work"]);
    expect(notesHiddenByTag.value).toBe(0);
  });
});

describe("reorderNotes", () => {
  /**
   * The whole manual order by title, hidden notes included. `sortedNotes`
   * answers for the view on screen, which is exactly what these tests must
   * not read: where an archived or trashed note sits on the same number line
   * is the thing being checked.
   */
  const order = () =>
    [...notes.value]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((n) => n.title);

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
    const n1 = await createNoteOrFail({ title: "A", position: 0 });
    const n2 = await createNoteOrFail({ title: "B", position: 1 });
    const n3 = await createNoteOrFail({ title: "C", position: 2 });
    // Move A from index 0 to index 2
    await reorderNotes([n1.id, n2.id, n3.id], 0, 2);
    const sorted = [...notes.value].sort((a, b) => a.position - b.position);
    expect(sorted.map((n) => n.title)).toEqual(["B", "C", "A"]);
  });

  it("reorderNotes is a no-op when fromIndex === toIndex", async () => {
    const n1 = await createNoteOrFail({ title: "A", position: 0 });
    const n2 = await createNoteOrFail({ title: "B", position: 1 });
    await reorderNotes([n1.id, n2.id], 0, 0);
    // Positions unchanged
    expect(notes.value.find((n) => n.id === n1.id)?.position).toBe(0);
    expect(notes.value.find((n) => n.id === n2.id)?.position).toBe(1);
  });

  it("moves the one note that was dropped and leaves the rest alone", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(
        (await createNoteOrFail({ title: `N${i}`, position: i * 1000 })).id,
      );
    }
    const before = new Map(notes.value.map((n) => [n.id, n.position]));
    await reorderNotes(ids, 5, 1);

    const moved = notes.value.filter((n) => before.get(n.id) !== n.position);
    expect(moved).toHaveLength(1);
    expect(moved[0].id).toBe(ids[5]);
    expect(order()).toEqual(["N0", "N5", "N1", "N2", "N3", "N4"]);
  });

  it("drops a note at the head without renumbering the head", async () => {
    const a = await createNoteOrFail({ title: "A", position: 1000 });
    const b = await createNoteOrFail({ title: "B", position: 2000 });
    await reorderNotes([a.id, b.id], 1, 0);
    expect(notes.value.find((n) => n.id === a.id)?.position).toBe(1000);
    expect(order()).toEqual(["B", "A"]);
  });

  it("leaves a note that is not on screen where it was", async () => {
    // The archived note sits between B and C on the same number line. A drag
    // among the visible three used to renumber them to 1000, 2000, 3000,
    // which put the archived note's old 25 ahead of all of them: restore it
    // and it jumped to the top of the board.
    const a = await createNoteOrFail({ title: "A", position: 10 });
    const b = await createNoteOrFail({ title: "B", position: 20 });
    const c = await createNoteOrFail({ title: "C", position: 30 });
    await createNoteOrFail({
      title: "Archived",
      position: 25,
      archived: true,
    });

    const section = [a.id, b.id, c.id];
    await reorderNotes(section, 0, 1);

    // A sits between B and the archived note, which has not moved at all.
    expect(notes.value.find((n) => n.title === "Archived")?.position).toBe(25);
    expect(order()).toEqual(["B", "A", "Archived", "C"]);
  });

  it("spreads everything out again when a gap has no room left", async () => {
    // Two adjacent doubles: there is no number between them to drop into, so
    // the midpoint rounds back onto one of the two and the fallback runs.
    const a = await createNoteOrFail({ title: "A", position: 1 });
    const b = await createNoteOrFail({
      title: "B",
      position: 1 + Number.EPSILON,
    });
    const c = await createNoteOrFail({ title: "C", position: 3 });
    await createNoteOrFail({ title: "Hidden", position: 2, trashed: true });

    await reorderNotes([a.id, b.id, c.id], 2, 1);

    // Everything is spaced out again, the hidden note included, and C landed
    // where it was dropped.
    expect(notes.value.map((n) => n.position).sort((x, y) => x - y)).toEqual([
      1000, 2000, 3000, 4000,
    ]);
    expect(order()).toEqual(["A", "C", "B", "Hidden"]);
  });

  it("orders two notes that share a position by id", async () => {
    // Two devices can pick the same midpoint for the same gap. Whichever
    // order the notes are held in, both devices must show the same board.
    const first = await createNoteOrFail({ title: "First", position: 100 });
    const second = await createNoteOrFail({ title: "Second", position: 100 });
    const [low, high] =
      first.id < second.id ? [first, second] : [second, first];

    const shown = () => sortedNotes.value.map((n) => n.title);
    notes.value = [high, low];
    expect(shown()).toEqual([low.title, high.title]);
    notes.value = [low, high];
    expect(shown()).toEqual([low.title, high.title]);
  });
});

describe("failure reporting", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    activeView.value = "active";
    selectMode.value = false;
    selectedNotes.value = new Set();
    toasts.value = [];
  });

  afterEach(() => {
    localStorage.clear();
    toasts.value = [];
  });

  /**
   * Three notes in the signal that storage has never heard of, so every write
   * against them fails. That is the shape of a real partial failure (a note
   * deleted from another device, a row the server rejects) without having to
   * reach into the adapter.
   */
  function selectPhantomNotes(count: number): string[] {
    const ids = Array.from({ length: count }, (_, i) => `phantom-${i}`);
    notes.value = ids.map((id) => ({
      ...baseNote,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    selectMode.value = true;
    selectedNotes.value = new Set(ids);
    return ids;
  }

  it("raises one message for a whole failed bulk operation", async () => {
    // Every failing note used to raise its own toast, so twenty selected notes
    // meant twenty toasts stacked over the grid.
    selectPhantomNotes(3);

    const ok = await bulkArchive();

    expect(ok).toBe(false);
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe(plural("error.bulkFailed", 3));
  });

  it("says nothing when a bulk operation succeeds", async () => {
    const a = await createNoteOrFail({ title: "A" });
    const b = await createNoteOrFail({ title: "B" });
    selectMode.value = true;
    selectedNotes.value = new Set([a.id, b.id]);

    const ok = await bulkArchive();

    expect(ok).toBe(true);
    expect(toasts.value).toHaveLength(0);
    expect(notes.value.every((n) => n.archived)).toBe(true);
  });

  it("counts only the notes that actually failed", async () => {
    const real = await createNoteOrFail({ title: "Real" });
    const phantoms = selectPhantomNotes(2);
    notes.value = [...notes.value, real];
    selectedNotes.value = new Set([...phantoms, real.id]);

    await bulkTrash();

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe(plural("error.bulkFailed", 2));
    expect(notes.value.find((n) => n.id === real.id)?.trashed).toBe(true);
  });

  it("reports a nested batch once", async () => {
    // `bulkAddTag` delegates to `addTagToNotes`, which is itself a batch.
    selectPhantomNotes(2);

    await bulkAddTag("shopping");

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe(plural("error.bulkFailed", 2));
  });

  it("reports a lone failure after two groups overlapped", async () => {
    // Two groups in flight at once, the first finishing first. Each counts
    // its own failures, so neither can leave a finished group behind to
    // swallow every failure that follows.
    const [phantom] = selectPhantomNotes(1);
    let releaseFirst = () => {};
    let releaseSecond = () => {};
    const first = asBatch(
      () => new Promise<void>((resolve) => (releaseFirst = resolve)),
    );
    const second = asBatch(
      () => new Promise<void>((resolve) => (releaseSecond = resolve)),
    );
    releaseFirst();
    await first;
    releaseSecond();
    await second;

    await updateNote(phantom, { title: "Lost" });

    expect(toasts.value).toHaveLength(1);
  });

  it("leaves select mode even when everything failed", async () => {
    // Otherwise the toolbar stays up over a selection nothing can act on.
    selectPhantomNotes(2);

    await bulkDelete();

    expect(selectMode.value).toBe(false);
    expect(selectedNotes.value.size).toBe(0);
  });
});
