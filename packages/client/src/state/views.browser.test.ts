import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { notes } from "./notesStore.js";
import { hiddenTags, sortMode } from "./prefs.js";
import {
  activeTag,
  activeView,
  clearSearchFilters,
  editingNoteId,
  searchQuery,
  tagsShowActive,
  tagsShowArchived,
  tagsShowTrashed,
} from "./ui.js";
import {
  allTags,
  canReorder,
  editingNote,
  filteredNotes,
  inViewLocation,
  notesHiddenByTag,
  pinnedNotes,
  setTagHidden,
  sortedNotes,
  tagCounts,
  unpinnedNotes,
} from "./views.js";

let seq = 0;

function note(overrides: Partial<Note> = {}): Note {
  seq++;
  return {
    id: `01J00000000000000000000${String(seq).padStart(3, "0")}`,
    title: `Note ${seq}`,
    content: "",
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: seq,
    tags: [],
    images: [],
    linkPreviews: [],
    reminder: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function reminder(time: string): Note["reminder"] {
  return { time, recurrence: "none", timezone: "UTC" };
}

const titles = (list: Note[]) => list.map((n) => n.title);

beforeEach(() => {
  localStorage.clear();
  notes.value = [];
  activeView.value = "active";
  activeTag.value = null;
  tagsShowActive.value = true;
  tagsShowArchived.value = false;
  tagsShowTrashed.value = false;
  editingNoteId.value = null;
  sortMode.value = "default";
  hiddenTags.value = [];
  clearSearchFilters();
});

afterEach(() => {
  notes.value = [];
  hiddenTags.value = [];
  activeView.value = "active";
  activeTag.value = null;
  clearSearchFilters();
  localStorage.clear();
});

describe("the tags view", () => {
  beforeEach(() => {
    notes.value = [
      note({ title: "work active", tags: ["work"] }),
      note({ title: "work archived", tags: ["work"], archived: true }),
      note({
        title: "work trashed",
        tags: ["work"],
        trashed: true,
        trashedAt: "2026-01-02T00:00:00.000Z",
      }),
      note({ title: "home active", tags: ["home"] }),
      note({ title: "untagged" }),
    ];
    activeView.value = "tags";
  });

  it("shows the active notes of the chosen tag", () => {
    activeTag.value = "work";
    expect(titles(filteredNotes.value)).toEqual(["work active"]);
  });

  it("adds the archive and the trash only when asked for", () => {
    activeTag.value = "work";
    tagsShowArchived.value = true;
    expect(titles(filteredNotes.value)).toEqual([
      "work active",
      "work archived",
    ]);
    tagsShowTrashed.value = true;
    tagsShowActive.value = false;
    expect(titles(filteredNotes.value)).toEqual([
      "work archived",
      "work trashed",
    ]);
  });

  it("shows every tagged and untagged note with no tag chosen", () => {
    expect(titles(filteredNotes.value)).toEqual([
      "work active",
      "home active",
      "untagged",
    ]);
  });

  it("matches a tag whole, not by its prefix", () => {
    notes.value = [
      ...notes.value,
      note({ title: "workshop", tags: ["workshop"] }),
    ];
    activeTag.value = "work";
    expect(titles(filteredNotes.value)).toEqual(["work active"]);
  });
});

describe("hidden tags", () => {
  it("keeps a hidden tag's notes out of Notes and says how many", () => {
    notes.value = [
      note({ title: "visible", tags: ["home"] }),
      note({ title: "secret", tags: ["private", "home"] }),
      note({ title: "old secret", tags: ["private"], archived: true }),
    ];
    setTagHidden("private", true);
    expect(hiddenTags.value).toEqual(["private"]);
    expect(titles(filteredNotes.value)).toEqual(["visible"]);
    // The archived one is not in Notes anyway, so it is not counted.
    expect(notesHiddenByTag.value).toBe(1);
  });

  it("still shows a hidden tag's notes in its own tag view and in search", () => {
    notes.value = [note({ title: "secret", tags: ["private"] })];
    setTagHidden("private", true);
    activeView.value = "tags";
    activeTag.value = "private";
    expect(titles(filteredNotes.value)).toEqual(["secret"]);
    activeView.value = "search";
    searchQuery.value = "secret";
    expect(titles(filteredNotes.value)).toEqual(["secret"]);
  });

  it("lets a tag back in, and hides one only once however often it is asked", () => {
    setTagHidden("a", true);
    setTagHidden("a", true);
    setTagHidden("b", true);
    expect(hiddenTags.value).toEqual(["a", "b"]);
    setTagHidden("a", false);
    expect(hiddenTags.value).toEqual(["b"]);
    expect(notesHiddenByTag.value).toBe(0);
  });
});

describe("the reminders and auto-notes views", () => {
  it("lists notes with a reminder, soonest first, and none from the trash", () => {
    notes.value = [
      note({ title: "later", reminder: reminder("2026-05-02T09:00:00") }),
      note({ title: "none" }),
      note({
        title: "archived soon",
        archived: true,
        reminder: reminder("2026-05-01T08:00:00"),
      }),
      note({
        title: "trashed",
        trashed: true,
        reminder: reminder("2026-04-01T08:00:00"),
      }),
    ];
    activeView.value = "reminders";
    expect(titles(sortedNotes.value)).toEqual(["archived soon", "later"]);
  });

  it("lists only generated notes in Auto-notes", () => {
    notes.value = [
      note({ title: "mine" }),
      note({ title: "generated", readonly: true }),
      note({ title: "generated archived", readonly: true, archived: true }),
    ];
    activeView.value = "autoNotes";
    expect(titles(filteredNotes.value)).toEqual(["generated"]);
  });
});

describe("inViewLocation", () => {
  it("says whether a note belongs where the view is looking", () => {
    const active = { archived: false, trashed: false, reminder: null };
    const archived = { archived: true, trashed: false, reminder: null };
    const trashed = { archived: false, trashed: true, reminder: null };
    activeView.value = "active";
    expect([active, archived, trashed].map(inViewLocation)).toEqual([
      true,
      false,
      false,
    ]);
    activeView.value = "archived";
    expect([active, archived, trashed].map(inViewLocation)).toEqual([
      false,
      true,
      false,
    ]);
    activeView.value = "trash";
    expect([active, archived, trashed].map(inViewLocation)).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe("sorting and pinning", () => {
  it("sorts the trash by when a note was trashed, newest first, whatever the sort", () => {
    notes.value = [
      note({
        title: "first",
        trashed: true,
        trashedAt: "2026-01-01T00:00:00Z",
      }),
      note({ title: "last", trashed: true, trashedAt: "2026-03-01T00:00:00Z" }),
      note({
        title: "middle",
        trashed: true,
        trashedAt: "2026-02-01T00:00:00Z",
      }),
    ];
    activeView.value = "trash";
    sortMode.value = "created";
    expect(titles(sortedNotes.value)).toEqual(["last", "middle", "first"]);
  });

  it("sorts by last change when asked", () => {
    notes.value = [
      note({ title: "old", updatedAt: "2026-01-01T00:00:00.000Z" }),
      note({ title: "new", updatedAt: "2026-06-01T00:00:00Z" }),
    ];
    sortMode.value = "updated";
    expect(titles(sortedNotes.value)).toEqual(["new", "old"]);
  });

  it("splits the board into pinned and the rest, each in the board's order", () => {
    notes.value = [
      note({ title: "b", position: 2 }),
      note({ title: "pinned z", position: 9, pinned: true }),
      note({ title: "a", position: 1 }),
      note({ title: "pinned y", position: 8, pinned: true }),
    ];
    expect(titles(pinnedNotes.value)).toEqual(["pinned y", "pinned z"]);
    expect(titles(unpinnedNotes.value)).toEqual(["a", "b"]);
  });
});

describe("tag counts", () => {
  it("counts only notes on the board, and lists tags in order", () => {
    notes.value = [
      note({ tags: ["b", "a"] }),
      note({ tags: ["a"] }),
      note({ tags: ["archived-only"], archived: true }),
      note({ tags: ["trashed-only", "a"], trashed: true }),
    ];
    expect(Object.fromEntries(tagCounts.value)).toEqual({ a: 2, b: 1 });
    expect(allTags.value).toEqual(["a", "b"]);
  });
});

describe("canReorder", () => {
  it("allows a drag only on the Notes or Auto-notes board, in manual order, with nothing else going on", () => {
    expect(canReorder.value).toBe(true);
    activeView.value = "autoNotes";
    expect(canReorder.value).toBe(true);
    for (const view of [
      "archived",
      "trash",
      "tags",
      "reminders",
      "search",
    ] as const) {
      activeView.value = view;
      expect(canReorder.value, view).toBe(false);
    }
    activeView.value = "active";
    sortMode.value = "updated";
    expect(canReorder.value).toBe(false);
    sortMode.value = "default";
    searchQuery.value = "x";
    expect(canReorder.value).toBe(false);
    searchQuery.value = "";
    editingNoteId.value = "open";
    expect(canReorder.value).toBe(false);
  });
});

describe("editingNote", () => {
  it("is the note being edited, or null once it is gone", () => {
    const open = note({ title: "open" });
    notes.value = [open];
    editingNoteId.value = open.id;
    expect(editingNote.value?.title).toBe("open");
    notes.value = [];
    expect(editingNote.value).toBeNull();
  });
});
