import { NoteColor } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNoteOrFail } from "../test/testSupport.js";
import { hasChecklist } from "../utils/markdown.js";
import { notes, updateNote } from "./notesStore.js";
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
import { filteredNotes, sortedNotes } from "./views.js";

describe("hasChecklist", () => {
  it("detects checklist lines with and without bullets", () => {
    expect(hasChecklist("- [ ] todo")).toBe(true);
    expect(hasChecklist("- [x] done")).toBe(true);
    expect(hasChecklist("[ ] bare")).toBe(true);
    expect(hasChecklist("hello")).toBe(false);
    expect(hasChecklist("")).toBe(false);
  });

  it("detects checklist lines mixed with other content", () => {
    expect(hasChecklist("heading\n- [ ] item\nmore text")).toBe(true);
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
    await createNoteOrFail({ title: "Active" });
    await createNoteOrFail({ title: "Archived", archived: true });
    await createNoteOrFail({
      title: "Trashed",
      trashed: true,
      trashedAt: new Date().toISOString(),
    });
    expect(filteredNotes.value).toHaveLength(0);
  });

  it("filters by checklist type", async () => {
    await createNoteOrFail({ title: "Plain" });
    const checklist = await createNoteOrFail({
      title: "List",
      content: "- [ ] do thing",
    });
    toggleSearchType("checklists");
    expect(filteredNotes.value.map((n) => n.id)).toEqual([checklist.id]);
  });

  it("filters by image type", async () => {
    await createNoteOrFail({ title: "No img" });
    const withImg = await createNoteOrFail({
      title: "Photo",
      images: ["data:image/png;base64,xxx"],
    });
    toggleSearchType("images");
    expect(filteredNotes.value.map((n) => n.id)).toEqual([withImg.id]);
  });

  it("filters by url type", async () => {
    await createNoteOrFail({ title: "Plain" });
    const withLink = await createNoteOrFail({
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
    await createNoteOrFail({ title: "No reminder" });
    const withReminder = await createNoteOrFail({
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
    const image = await createNoteOrFail({
      title: "Image",
      images: ["data:image/png;base64,xxx"],
    });
    const list = await createNoteOrFail({
      title: "List",
      content: "- [ ] item",
    });
    await createNoteOrFail({ title: "Neither" });
    toggleSearchType("images");
    toggleSearchType("checklists");
    const ids = filteredNotes.value.map((n) => n.id).sort();
    expect(ids).toEqual([image.id, list.id].sort());
  });

  it("filters by color", async () => {
    const red = await createNoteOrFail({ title: "Red", color: NoteColor.Red });
    await createNoteOrFail({ title: "Blue", color: NoteColor.Blue });
    toggleSearchColor(NoteColor.Red);
    expect(filteredNotes.value.map((n) => n.id)).toEqual([red.id]);
  });

  it("combines types and colors with AND between groups", async () => {
    const redImg = await createNoteOrFail({
      title: "RedImg",
      color: NoteColor.Red,
      images: ["data:image/png;base64,xxx"],
    });
    await createNoteOrFail({
      title: "BlueImg",
      color: NoteColor.Blue,
      images: ["data:image/png;base64,xxx"],
    });
    await createNoteOrFail({ title: "RedPlain", color: NoteColor.Red });
    toggleSearchType("images");
    toggleSearchColor(NoteColor.Red);
    expect(filteredNotes.value.map((n) => n.id)).toEqual([redImg.id]);
  });

  it("narrows by text query", async () => {
    const hi = await createNoteOrFail({ title: "Hello world" });
    await createNoteOrFail({ title: "Other" });
    searchQuery.value = "hello";
    expect(filteredNotes.value.map((n) => n.id)).toEqual([hi.id]);
  });

  it("finds a note holding every word of the query, in any order", async () => {
    const both = await createNoteOrFail({
      title: "Shopping",
      content: "eggs, bread and **milk**",
    });
    await createNoteOrFail({ title: "Milk only", content: "just milk" });
    searchQuery.value = "milk eggs";
    expect(filteredNotes.value.map((n) => n.id)).toEqual([both.id]);
  });

  it("ignores accents on either side", async () => {
    const weather = await createNoteOrFail({ title: "Sää huomenna" });
    const cafe = await createNoteOrFail({ title: "Cafe list" });
    searchQuery.value = "saa";
    expect(filteredNotes.value.map((n) => n.id)).toEqual([weather.id]);
    searchQuery.value = "café";
    expect(filteredNotes.value.map((n) => n.id)).toEqual([cafe.id]);
  });

  it("puts title matches first and keeps the sort within each group", async () => {
    sortMode.value = "created";
    const inText = await createNoteOrFail({
      title: "Errands",
      content: "buy milk",
    });
    const olderTitle = await createNoteOrFail({ title: "Milk brands" });
    const newerTitle = await createNoteOrFail({ title: "Oat milk" });
    const createdAt = new Map([
      [inText.id, "2026-01-03T00:00:00.000Z"],
      [olderTitle.id, "2026-01-01T00:00:00.000Z"],
      [newerTitle.id, "2026-01-02T00:00:00.000Z"],
    ]);
    notes.value = notes.value.map((n) => ({
      ...n,
      createdAt: createdAt.get(n.id) ?? n.createdAt,
    }));
    searchQuery.value = "milk";
    expect(sortedNotes.value.map((n) => n.id)).toEqual([
      newerTitle.id,
      olderTitle.id,
      inText.id,
    ]);
  });

  it("finds a note again after its text changes", async () => {
    const note = await createNoteOrFail({ title: "Before" });
    searchQuery.value = "after";
    expect(filteredNotes.value).toHaveLength(0);
    await updateNote(note.id, { title: "After" });
    expect(filteredNotes.value.map((n) => n.id)).toEqual([note.id]);
  });

  it("clearSearchFilters resets query, types, colors, and locations", async () => {
    await createNoteOrFail({ title: "x", color: NoteColor.Red });
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
    const withImg = await createNoteOrFail({
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
    const active = await createNoteOrFail({ title: "Note one" });
    const trashed = await createNoteOrFail({ title: "Note two" });
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
    await createNoteOrFail({ title: "Note one" });
    const archived = await createNoteOrFail({
      title: "Note two",
      archived: true,
    });
    searchQuery.value = "note";
    toggleSearchLocation("active");
    toggleSearchLocation("archived");
    expect(filteredNotes.value.map((n) => n.id)).toEqual([archived.id]);
  });

  it("narrows to only trashed when only Trash is selected", async () => {
    await createNoteOrFail({ title: "Note one" });
    const trashed = await createNoteOrFail({ title: "Note two" });
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
