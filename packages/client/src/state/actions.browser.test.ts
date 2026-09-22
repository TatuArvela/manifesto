import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { t } from "../i18n/index.js";
import { quotaRefusedAt } from "../storage/quota.js";
import {
  archiveNote,
  deleteCheckedItems,
  expireTrash,
  filteredNotes,
  hasCheckedItems,
  leavingNotes,
  loadNotes,
  noteHasChecklist,
  notes,
  notesLoaded,
  permanentlyDeleteNote,
  receiveNote,
  restoreNote,
  sortedNotes,
  toggleCheckbox,
  togglePin,
  trashNote,
  unarchiveNote,
  updateNote,
  upsertById,
} from "./actions.js";
import { animations, sortMode } from "./prefs.js";
import { createNoteOrFail } from "./testSupport.js";
import { activeView, searchLocations, searchQuery, toasts } from "./ui.js";

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
    const note = await createNoteOrFail({ title: "Hello" });
    expect(note.title).toBe("Hello");
    expect(notes.value).toHaveLength(1);
    expect(notes.value[0].id).toBe(note.id);
  });

  it("createNote does not duplicate a note already added by a WS echo", async () => {
    // In server mode the backend can broadcast note:created (which upserts into
    // the list) before our own create() resolves. Simulate that echo landing
    // first, then let createNote's optimistic insert run.
    const note = await createNoteOrFail({ title: "Echoed" });
    notes.value = upsertById(notes.value, note); // second, racing insert
    expect(notes.value.filter((n) => n.id === note.id)).toHaveLength(1);
    expect(notes.value).toHaveLength(1);
  });

  it("upsertById replaces an existing note in place", async () => {
    const note = await createNoteOrFail({ title: "First" });
    notes.value = upsertById(notes.value, { ...note, title: "Edited" });
    expect(notes.value).toHaveLength(1);
    expect(notes.value[0].title).toBe("Edited");
  });

  it("updateNote modifies a note", async () => {
    const note = await createNoteOrFail({ title: "Original" });
    await updateNote(note.id, { title: "Updated" });
    expect(notes.value[0].title).toBe("Updated");
  });

  it("updateNote shows the change before storage has answered", async () => {
    const note = await createNoteOrFail({ title: "Original" });
    // Not awaited: what the user sees between the click and the answer.
    const saved = updateNote(note.id, { title: "Updated" });
    expect(notes.value[0].title).toBe("Updated");
    expect(await saved).toBe(true);
    expect(notes.value[0].title).toBe("Updated");
  });

  it("updateNote takes the change back when the write fails", async () => {
    await createNoteOrFail({ title: "Original" });
    // A note storage has never heard of: the write cannot land.
    notes.value = [{ ...notes.value[0], id: "does-not-exist" }];
    const shown = updateNote("does-not-exist", { title: "Updated" });
    expect(notes.value[0].title).toBe("Updated");
    expect(await shown).toBe(false);
    expect(notes.value[0].title).toBe("Original");
  });

  it("receiveNote ignores a copy that says nothing new", async () => {
    const note = await createNoteOrFail({ title: "Echoed" });
    const before = notes.value;
    receiveNote({ ...note });
    expect(notes.value).toBe(before);
  });

  it("receiveNote keeps a write the server has not answered yet", async () => {
    const note = await createNoteOrFail({ title: "Original" });
    const saved = updateNote(note.id, { pinned: true });
    // Another device renames the note while our pin is still in the air.
    receiveNote({
      ...notes.value[0],
      pinned: false,
      title: "Renamed elsewhere",
      updatedAt: "2099-01-01T00:00:00.000Z",
    });
    expect(notes.value[0].title).toBe("Renamed elsewhere");
    expect(notes.value[0].pinned).toBe(true);
    await saved;
  });

  it("updateNote reports a nonexistent note rather than rejecting", async () => {
    // The contract at the top of actions.ts: an action tells the user and
    // resolves. Rejecting instead left every JSX handler (none of which can
    // hold a `catch`) raising an unhandled rejection the user never saw.
    await expect(updateNote("fake", { title: "X" })).resolves.toBe(false);
    expect(toasts.value.at(-1)?.message).toBe(t("error.saveFailed"));
  });

  it("permanentlyDeleteNote removes from state", async () => {
    const note = await createNoteOrFail({ title: "Delete me" });
    await permanentlyDeleteNote(note.id);
    expect(notes.value).toHaveLength(0);
  });

  it("trashNote sets trashed flag", async () => {
    const note = await createNoteOrFail({ title: "Trash me" });
    await trashNote(note.id);
    expect(notes.value[0].trashed).toBe(true);
    expect(notes.value[0].trashedAt).toBeTruthy();
    expect(notes.value[0].archived).toBe(false);
  });

  it("trashNote lets the card animate out before the note leaves the grid", async () => {
    const previous = animations.value;
    animations.value = true;
    try {
      const note = await createNoteOrFail({ title: "Toss me" });
      const done = trashNote(note.id);
      // Still in the grid, but flagged: this is the window the card spends
      // playing `.note-leaving`.
      expect(leavingNotes.value.get(note.id)).toBe("discard");
      expect(sortedNotes.value.map((n) => n.id)).toContain(note.id);
      await done;
      expect(leavingNotes.value.size).toBe(0);
      expect(sortedNotes.value).toHaveLength(0);
    } finally {
      animations.value = previous;
    }
  });

  it("trashNote does not wait on an animation that is turned off", async () => {
    const previous = animations.value;
    animations.value = false;
    try {
      const note = await createNoteOrFail({ title: "Quietly" });
      const done = trashNote(note.id);
      expect(leavingNotes.value.size).toBe(0);
      await done;
      expect(notes.value[0].trashed).toBe(true);
    } finally {
      animations.value = previous;
    }
  });

  it("a failed delete brings the card back", async () => {
    const previous = animations.value;
    animations.value = true;
    try {
      const note = await createNoteOrFail({ title: "Stubborn" });
      // Gone from storage underneath the signal, so the update fails.
      localStorage.clear();
      await expect(trashNote(note.id)).resolves.toBe(false);
      expect(leavingNotes.value.size).toBe(0);
      expect(sortedNotes.value.map((n) => n.id)).toContain(note.id);
    } finally {
      animations.value = previous;
    }
  });

  it("archiveNote animates the card up and away before it leaves", async () => {
    const previous = animations.value;
    animations.value = true;
    try {
      const note = await createNoteOrFail({ title: "Put away" });
      const done = archiveNote(note.id);
      expect(leavingNotes.value.get(note.id)).toBe("archive");
      await done;
      expect(leavingNotes.value.size).toBe(0);
      expect(notes.value[0].archived).toBe(true);
    } finally {
      animations.value = previous;
    }
  });

  it("restoreNote and unarchiveNote animate the card back out of their view", async () => {
    const previous = animations.value;
    animations.value = true;
    try {
      const trashed = await createNoteOrFail({ title: "Undelete me" });
      await trashNote(trashed.id);
      activeView.value = "trash";
      const restoring = restoreNote(trashed.id);
      expect(leavingNotes.value.get(trashed.id)).toBe("restore");
      await restoring;

      const archived = await createNoteOrFail({ title: "Unarchive me" });
      await archiveNote(archived.id);
      activeView.value = "archived";
      const unarchiving = unarchiveNote(archived.id);
      expect(leavingNotes.value.get(archived.id)).toBe("restore");
      await unarchiving;

      expect(leavingNotes.value.size).toBe(0);
    } finally {
      animations.value = previous;
    }
  });

  it("does not animate a card that the change leaves in the view", async () => {
    // A search across every location still shows the note once it is
    // archived, so playing the exit would blink it out and back.
    const previous = animations.value;
    animations.value = true;
    try {
      const note = await createNoteOrFail({ title: "Still here" });
      activeView.value = "search";
      searchQuery.value = "still";
      searchLocations.value = new Set(["active", "archived"]);
      expect(sortedNotes.value.map((n) => n.id)).toContain(note.id);
      const done = archiveNote(note.id);
      expect(leavingNotes.value.size).toBe(0);
      await done;
      expect(sortedNotes.value.map((n) => n.id)).toContain(note.id);
    } finally {
      animations.value = previous;
      searchLocations.value = new Set(["active"]);
    }
  });

  it("restoreNote clears trashed flag", async () => {
    const note = await createNoteOrFail({ title: "Restore me" });
    await trashNote(note.id);
    await restoreNote(note.id);
    expect(notes.value[0].trashed).toBe(false);
    expect(notes.value[0].trashedAt).toBeNull();
  });

  it("archiveNote and unarchiveNote toggle archived", async () => {
    const note = await createNoteOrFail({ title: "Archive" });
    await archiveNote(note.id);
    expect(notes.value[0].archived).toBe(true);
    await unarchiveNote(note.id);
    expect(notes.value[0].archived).toBe(false);
  });

  it("togglePin flips the pinned flag", async () => {
    const note = await createNoteOrFail({ title: "Pin me" });
    expect(notes.value[0].pinned).toBe(false);
    await togglePin(note.id);
    expect(notes.value[0].pinned).toBe(true);
    await togglePin(note.id);
    expect(notes.value[0].pinned).toBe(false);
  });

  it("toggleCheckbox flips checkbox state", async () => {
    const note = await createNoteOrFail({ content: "- [ ] A\n- [x] B" });
    await toggleCheckbox(note.id, 0);
    expect(notes.value[0].content).toBe("- [x] A\n- [x] B");
    await toggleCheckbox(note.id, 1);
    expect(notes.value[0].content).toBe("- [x] A\n- [ ] B");
  });

  it("toggleCheckbox cascades to nested descendants", async () => {
    const note = await createNoteOrFail({
      content:
        "- [ ] Parent\n  - [ ] Child\n    - [ ] Grandchild\n  - [x] Child2\n- [ ] Sibling",
    });
    await toggleCheckbox(note.id, 0);
    expect(notes.value[0].content).toBe(
      "- [x] Parent\n  - [x] Child\n    - [x] Grandchild\n  - [x] Child2\n- [ ] Sibling",
    );
    await toggleCheckbox(note.id, 0);
    expect(notes.value[0].content).toBe(
      "- [ ] Parent\n  - [ ] Child\n    - [ ] Grandchild\n  - [ ] Child2\n- [ ] Sibling",
    );
  });

  it("toggleCheckbox on leaf does not touch siblings", async () => {
    const note = await createNoteOrFail({
      content: "- [ ] Parent\n  - [ ] Child1\n  - [ ] Child2",
    });
    await toggleCheckbox(note.id, 1);
    expect(notes.value[0].content).toBe(
      "- [ ] Parent\n  - [x] Child1\n  - [ ] Child2",
    );
  });

  // A note that documents checklist syntax inside a code fence. The preview
  // renders the fenced lines as code (no boxes), so anything that offers or
  // performs a checklist action has to see them the same way. When it did
  // not, "Delete checked items" cut lines out of the middle of the block and
  // left the fence unterminated.
  const FENCED = [
    "- [x] Real item",
    "",
    "```markdown",
    "- [x] Example in docs",
    "  - [x] Nested example",
    "```",
    "",
    "- [ ] Another real item",
  ].join("\n");

  it("noteHasChecklist ignores checklist lines inside a code fence", () => {
    expect(noteHasChecklist(FENCED)).toBe(true);
    expect(noteHasChecklist("```\n- [ ] Only inside a fence\n```")).toBe(false);
  });

  it("hasCheckedItems ignores ticked boxes inside a code fence", () => {
    expect(hasCheckedItems(FENCED)).toBe(true);
    expect(hasCheckedItems("```\n- [x] Only inside a fence\n```")).toBe(false);
    expect(hasCheckedItems("- [ ] Open\n\n```\n- [x] Quoted\n```")).toBe(false);
  });

  it("deleteCheckedItems leaves a fenced code block intact", async () => {
    const note = await createNoteOrFail({ content: FENCED });

    await deleteCheckedItems(note.id);

    expect(notes.value[0].content).toBe(
      [
        "",
        "```markdown",
        "- [x] Example in docs",
        "  - [x] Nested example",
        "```",
        "",
        "- [ ] Another real item",
      ].join("\n"),
    );
  });

  it("deleteCheckedItems does not sweep descendants across a fence", async () => {
    // The subtree sweep walks forward by indent. An indented line inside a
    // fence is not the item's child, and taking it deletes the fence's body.
    const note = await createNoteOrFail({
      content: ["- [x] Parent", "```", "  indented code", "```"].join("\n"),
    });

    await deleteCheckedItems(note.id);

    expect(notes.value[0].content).toBe(
      ["```", "  indented code", "```"].join("\n"),
    );
  });

  it("toggleCheckbox refuses a line inside a code fence", async () => {
    const content = "```\n- [ ] Quoted\n```";
    const note = await createNoteOrFail({ content });

    await toggleCheckbox(note.id, 1);

    expect(notes.value[0].content).toBe(content);
  });

  it("loadNotes reads from storage", async () => {
    await createNoteOrFail({ title: "Persisted" });
    notes.value = [];
    expect(notes.value).toHaveLength(0);
    await loadNotes();
    expect(notes.value).toHaveLength(1);
    expect(notes.value[0].title).toBe("Persisted");
  });

  it("loadNotes marks the list as known, so the board may call it empty", async () => {
    notesLoaded.value = false;
    await loadNotes();
    expect(notes.value).toHaveLength(0);
    expect(notesLoaded.value).toBe(true);
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
    await createNoteOrFail({ title: "Active" });
    await createNoteOrFail({ title: "Archived", archived: true });
    await createNoteOrFail({ title: "Trashed", trashed: true });
    activeView.value = "active";
    expect(filteredNotes.value).toHaveLength(1);
    expect(filteredNotes.value[0].title).toBe("Active");
  });

  it("trash view shows only trashed notes", async () => {
    await createNoteOrFail({ title: "Active" });
    const trashed = await createNoteOrFail({ title: "Trashed" });
    await trashNote(trashed.id);
    activeView.value = "trash";
    expect(filteredNotes.value).toHaveLength(1);
    expect(filteredNotes.value[0].title).toBe("Trashed");
  });

  it("archived view shows only archived (not trashed)", async () => {
    const n1 = await createNoteOrFail({ title: "Archived" });
    await archiveNote(n1.id);
    const n2 = await createNoteOrFail({ title: "Both" });
    await archiveNote(n2.id);
    await trashNote(n2.id);
    activeView.value = "archived";
    expect(filteredNotes.value).toHaveLength(1);
    expect(filteredNotes.value[0].title).toBe("Archived");
  });

  it("search filters by title and content", async () => {
    await createNoteOrFail({ title: "Grocery list" });
    await createNoteOrFail({
      title: "Code review",
      content: "check groceries",
    });
    await createNoteOrFail({ title: "Random" });
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
    await createNoteOrFail({ title: "C", position: 3 });
    await createNoteOrFail({ title: "A", position: 1 });
    await createNoteOrFail({ title: "B", position: 2 });
    sortMode.value = "default";
    expect(sortedNotes.value.map((n) => n.title)).toEqual(["A", "B", "C"]);
  });

  it("sort by created (newest first)", async () => {
    await createNoteOrFail({ title: "First" });
    await new Promise((r) => setTimeout(r, 5));
    await createNoteOrFail({ title: "Second" });
    sortMode.value = "created";
    expect(sortedNotes.value[0].title).toBe("Second");
  });

  it("orders by time, not by the text of timestamps written differently", async () => {
    // As text, ".500Z" sorts before "Z", which would put the later note last.
    const early = await createNoteOrFail({ title: "Early" });
    const late = await createNoteOrFail({ title: "Late" });
    notes.value = notes.value.map((n) =>
      n.id === early.id
        ? { ...n, updatedAt: "2026-01-01T00:00:00Z" }
        : n.id === late.id
          ? { ...n, updatedAt: "2026-01-01T00:00:00.500Z" }
          : n,
    );
    sortMode.value = "updated";
    expect(sortedNotes.value.map((n) => n.title)).toEqual(["Late", "Early"]);
  });

  it("puts a trashed note with no trash time last in the trash", async () => {
    const dated = await createNoteOrFail({ title: "Dated", trashed: true });
    await createNoteOrFail({ title: "Undated", trashed: true });
    notes.value = notes.value.map((n) =>
      n.id === dated.id
        ? { ...n, trashedAt: "2026-01-01T00:00:00.000Z" }
        : { ...n, trashedAt: null },
    );
    activeView.value = "trash";
    expect(sortedNotes.value.map((n) => n.title)).toEqual(["Dated", "Undated"]);
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
    await createNoteOrFail({
      title: "Old trashed",
      trashed: true,
      trashedAt: oldDate,
    });
    await createNoteOrFail({ title: "Recent trashed", trashed: true });
    await createNoteOrFail({ title: "Active" });

    await expireTrash();
    expect(notes.value).toHaveLength(2);
    expect(notes.value.map((n) => n.title).sort()).toEqual([
      "Active",
      "Recent trashed",
    ]);
  });

  it("does not delete recently trashed notes", async () => {
    await createNoteOrFail({
      title: "Recent",
      trashed: true,
      trashedAt: new Date().toISOString(),
    });
    await expireTrash();
    expect(notes.value).toHaveLength(1);
  });
});

describe("the storage quota message", () => {
  // Storage reports a refused write and says nothing about it; this is where
  // the user-facing half of that lives, so this is where it is tested.
  //
  // The throttle below is module state in `actions.ts`, so each test takes a
  // fresh stretch of the clock rather than reusing `Date.now()` and being
  // silenced by whatever the test before it reported.
  let clock = Date.now();
  const nextMinute = () => {
    clock += 10 * 60 * 1000;
    return clock;
  };

  beforeEach(() => {
    toasts.value = [];
    quotaRefusedAt.value = 0;
  });

  afterEach(() => {
    toasts.value = [];
    quotaRefusedAt.value = 0;
  });

  const quotaToasts = () =>
    toasts.value.filter(
      (toast) => toast.message === t("storage.quotaExceeded"),
    );

  it("tells the user when a write was refused for space", () => {
    quotaRefusedAt.value = nextMinute();
    expect(quotaToasts()).toHaveLength(1);
    expect(quotaToasts()[0].type).toBe("error");
  });

  it("says it once a minute, not once per refused write", () => {
    // One editor close writes the note and a version, so a full store refuses
    // twice in a row and the user should still read one sentence.
    const at = nextMinute();
    quotaRefusedAt.value = at;
    quotaRefusedAt.value = at + 10;
    expect(quotaToasts()).toHaveLength(1);

    quotaRefusedAt.value = at + 60_001;
    expect(quotaToasts()).toHaveLength(2);
  });
});
