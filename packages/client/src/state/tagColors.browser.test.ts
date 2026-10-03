import { NoteColor } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNoteOrFail } from "../test/testSupport.js";
import { deleteTag, renameTag } from "./actions.js";
import { notes } from "./notesStore.js";
import { MAX_TAG_COLORS, tagColors } from "./prefs.js";
import { setTagColor } from "./views.js";

describe("tag colours", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    tagColors.value = {};
  });

  afterEach(() => {
    localStorage.clear();
    tagColors.value = {};
  });

  it("gives a tag a colour, changes it and takes it away", () => {
    expect(setTagColor("work", NoteColor.Red)).toBe(true);
    setTagColor("home", NoteColor.Blue);
    setTagColor("work", NoteColor.Green);
    expect(tagColors.value).toEqual({ work: "green", home: "blue" });

    setTagColor("work", null);
    expect(tagColors.value).toEqual({ home: "blue" });
  });

  it("refuses one coloured tag too many, but still recolours one it has", () => {
    tagColors.value = Object.fromEntries(
      Array.from({ length: MAX_TAG_COLORS }, (_, i) => [
        `tag${i}`,
        NoteColor.Blue,
      ]),
    );
    expect(setTagColor("one-more", NoteColor.Red)).toBe(false);
    expect(tagColors.value["one-more"]).toBeUndefined();
    expect(setTagColor("tag0", NoteColor.Red)).toBe(true);
    expect(tagColors.value.tag0).toBe("red");
  });

  it("moves the colour with a renamed tag", async () => {
    await createNoteOrFail({ title: "A", tags: ["wrok"] });
    setTagColor("wrok", NoteColor.Red);
    await renameTag("wrok", "work");
    expect(tagColors.value).toEqual({ work: "red" });
  });

  it("keeps the colour of the tag a rename merges into", async () => {
    await createNoteOrFail({ title: "A", tags: ["wrok"] });
    await createNoteOrFail({ title: "B", tags: ["work"] });
    setTagColor("wrok", NoteColor.Red);
    setTagColor("work", NoteColor.Blue);
    await renameTag("wrok", "work");
    expect(tagColors.value).toEqual({ work: "blue" });
  });

  it("drops the colour of a deleted tag", async () => {
    await createNoteOrFail({ title: "A", tags: ["work"] });
    setTagColor("work", NoteColor.Red);
    await deleteTag("work");
    expect(tagColors.value).toEqual({});
  });
});
