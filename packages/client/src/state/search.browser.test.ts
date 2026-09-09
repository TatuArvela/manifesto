import { NoteColor } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createNote,
  filteredNotes,
  noteHasChecklist,
  notes,
  updateNote,
} from "./actions.js";
import { sortMode } from "./prefs.js";
import {
  activeView,
  clearSearchFilters,
  searchColors,
  searchLocations,
  searchQuery,
  searchTypes,
  toggleSearchColor,
  toggleSearchLocation,
  toggleSearchType,
} from "./ui.js";

describe("noteHasChecklist", () => {
  it("detects checklist lines with and without bullets", () => {
    expect(noteHasChecklist("- [ ] todo")).toBe(true);
    expect(noteHasChecklist("- [x] done")).toBe(true);
    expect(noteHasChecklist("[ ] bare")).toBe(true);
    expect(noteHasChecklist("hello")).toBe(false);
    expect(noteHasChecklist("")).toBe(false);
  });

  it("detects checklist lines mixed with other content", () => {
    expect(noteHasChecklist("heading\n- [ ] item\nmore text")).toBe(true);
  });
});

describe("search view filtering", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    activeView.value = "search";
    sortMode.value = "default";
    clearSearchFilters();
  });

  afterEach(() => {
    localStorage.clear();
    activeView.value = "active";
    clearSearchFilters();
  });

  it("shows no notes when no query or filters are set", async () => {
    await createNote({ title: "Active" });
    await createNote({ title: "Archived", archived: true });
    await createNote({
      title: "Trashed",
      trashed: true,
      trashedAt: new Date().toISOString(),
    });
    expect(filteredNotes.value).toHaveLength(0);
  });

  it("filters by checklist type", async () => {
    await createNote({ title: "Plain" });
    const checklist = await createNote({
      title: "List",
      content: "- [ ] do thing",
    });
    toggleSearchType("checklists");
    expect(filteredNotes.value.map((n) => n.id)).toEqual([checklist.id]);
  });

  it("filters by image type", async () => {
    await createNote({ title: "No img" });
    const withImg = await createNote({
      title: "Photo",
      images: ["data:image/png;base64,xxx"],
    });
    toggleSearchType("images");
    expect(filteredNotes.value.map((n) => n.id)).toEqual([withImg.id]);
  });

  it("filters by url type", async () => {
    await createNote({ title: "Plain" });
    const withLink = await createNote({
      title: "Link",
      linkPreviews: [
        {
          url: "https://example.com",
          title: "Example",
          domain: "example.com",
        },
      ],
    });
    toggleSearchType("urls");
    expect(filteredNotes.value.map((n) => n.id)).toEqual([withLink.id]);
  });

  it("filters by reminder type", async () => {
    await createNote({ title: "No reminder" });
    const withReminder = await createNote({
      title: "Reminder",
      reminder: {
        time: new Date().toISOString(),
        recurrence: "none",
        timezone: "UTC",
      },
    });
    toggleSearchType("reminders");
    expect(filteredNotes.value.map((n) => n.id)).toEqual([withReminder.id]);
  });

  it("combines multiple types with OR semantics", async () => {
    const image = await createNote({
      title: "Image",
      images: ["data:image/png;base64,xxx"],
    });
    const list = await createNote({
      title: "List",
      content: "- [ ] item",
    });
    await createNote({ title: "Neither" });
    toggleSearchType("images");
    toggleSearchType("checklists");
    const ids = filteredNotes.value.map((n) => n.id).sort();
    expect(ids).toEqual([image.id, list.id].sort());
  });

  it("filters by color", async () => {
    const red = await createNote({ title: "Red", color: NoteColor.Red });
    await createNote({ title: "Blue", color: NoteColor.Blue });
    toggleSearchColor(NoteColor.Red);
    expect(filteredNotes.value.map((n) => n.id)).toEqual([red.id]);
  });

  it("combines types and colors with AND between groups", async () => {
    const redImg = await createNote({
      title: "RedImg",
      color: NoteColor.Red,
      images: ["data:image/png;base64,xxx"],
    });
    await createNote({
      title: "BlueImg",
      color: NoteColor.Blue,
      images: ["data:image/png;base64,xxx"],
    });
    await createNote({ title: "RedPlain", color: NoteColor.Red });
    toggleSearchType("images");
    toggleSearchColor(NoteColor.Red);
    expect(filteredNotes.value.map((n) => n.id)).toEqual([redImg.id]);
  });

  it("narrows by text query", async () => {
    const hi = await createNote({ title: "Hello world" });
    await createNote({ title: "Other" });
    searchQuery.value = "hello";
    expect(filteredNotes.value.map((n) => n.id)).toEqual([hi.id]);
  });

  it("clearSearchFilters resets query, types, colors, and locations", async () => {
    await createNote({ title: "x", color: NoteColor.Red });
    searchQuery.value = "nope";
    toggleSearchType("images");
    toggleSearchColor(NoteColor.Red);
    toggleSearchLocation("trashed");
    clearSearchFilters();
    expect(searchQuery.value).toBe("");
    expect(searchTypes.value.size).toBe(0);
    expect(searchColors.value.size).toBe(0);
    expect(searchLocations.value.size).toBe(1);
    expect(searchLocations.value.has("active")).toBe(true);
  });

  it("excludes trashed notes by default even with matching filters", async () => {
    const withImg = await createNote({
      title: "Trashy",
      images: ["data:image/png;base64,xxx"],
    });
    await updateNote(withImg.id, {
      trashed: true,
      trashedAt: new Date().toISOString(),
    });
    toggleSearchType("images");
    expect(filteredNotes.value).toHaveLength(0);
  });

  it("includes trashed notes when the Trash location is toggled on", async () => {
    const active = await createNote({ title: "Note one" });
    const trashed = await createNote({ title: "Note two" });
    await updateNote(trashed.id, {
      trashed: true,
      trashedAt: new Date().toISOString(),
    });
    searchQuery.value = "note";
    toggleSearchLocation("trashed");
    const ids = filteredNotes.value.map((n) => n.id).sort();
    expect(ids).toEqual([active.id, trashed.id].sort());
  });

  it("narrows to only archived when only Archived is selected", async () => {
    await createNote({ title: "Note one" });
    const archived = await createNote({ title: "Note two", archived: true });
    searchQuery.value = "note";
    toggleSearchLocation("active");
    toggleSearchLocation("archived");
    expect(filteredNotes.value.map((n) => n.id)).toEqual([archived.id]);
  });

  it("narrows to only trashed when only Trash is selected", async () => {
    await createNote({ title: "Note one" });
    const trashed = await createNote({ title: "Note two" });
    await updateNote(trashed.id, {
      trashed: true,
      trashedAt: new Date().toISOString(),
    });
    searchQuery.value = "note";
    toggleSearchLocation("active");
    toggleSearchLocation("trashed");
    expect(filteredNotes.value.map((n) => n.id)).toEqual([trashed.id]);
  });
});
