import { NoteColor } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNoteOrFail } from "../test/testSupport.js";
import { deleteTag, renameTag } from "./actions.js";
import { notes } from "./notesStore.js";
import { hiddenTags, tagColors } from "./prefs.js";
import { activeTag, activeView, searchQuery } from "./ui.js";
import {
  allTags,
  childTags,
  filteredNotes,
  hiddenThrough,
  notesHiddenByTag,
  setTagColor,
  setTagHidden,
  tagColorOf,
  tagCounts,
} from "./views.js";

function reset() {
  localStorage.clear();
  notes.value = [];
  hiddenTags.value = [];
  tagColors.value = {};
  activeView.value = "active";
  activeTag.value = null;
  searchQuery.value = "";
}

const titles = () => filteredNotes.value.map((n) => n.title).sort();
const tagsOf = (title: string) =>
  notes.value.find((n) => n.title === title)?.tags;

describe("nested tags", () => {
  beforeEach(async () => {
    reset();
    await createNoteOrFail({ title: "acme", tags: ["work/clients/acme"] });
    await createNoteOrFail({ title: "both", tags: ["work", "work/clients"] });
    await createNoteOrFail({ title: "shop", tags: ["workshop"] });
  });

  afterEach(reset);

  it("counts each note once under a tag and every tag above it", () => {
    expect(Object.fromEntries(tagCounts.value)).toEqual({
      work: 2,
      "work/clients": 2,
      "work/clients/acme": 1,
      workshop: 1,
    });
  });

  it("lists a tag that exists only as the start of another", async () => {
    await createNoteOrFail({ title: "deep", tags: ["home/garden"] });
    expect(allTags.value).toContain("home");
    expect(childTags(null)).toEqual(["home", "work", "workshop"]);
    expect(childTags("work")).toEqual(["work/clients"]);
    expect(childTags("work/clients")).toEqual(["work/clients/acme"]);
  });

  it("shows under a tag the notes of every tag below it", () => {
    activeView.value = "tags";
    activeTag.value = "work";
    expect(titles()).toEqual(["acme", "both"]);
    activeTag.value = "work/clients/acme";
    expect(titles()).toEqual(["acme"]);
  });

  it("hides the notes of the tags under a hidden tag", () => {
    setTagHidden("work", true);
    expect(titles()).toEqual(["shop"]);
    expect(notesHiddenByTag.value).toBe(2);
    expect(hiddenThrough("work/clients/acme")).toBe("work");
    expect(hiddenThrough("workshop")).toBeNull();
  });

  it("colours a tag from the nearest tag above it that has one", () => {
    setTagColor("work", NoteColor.Red);
    expect(tagColorOf("work/clients/acme")).toBe("red");
    setTagColor("work/clients", NoteColor.Blue);
    expect(tagColorOf("work/clients/acme")).toBe("blue");
    expect(tagColorOf("work")).toBe("red");
    expect(tagColorOf("workshop")).toBeUndefined();
  });

  it("renames the tags under a renamed tag, with what was set on them", async () => {
    setTagHidden("work/clients", true);
    setTagColor("work/clients/acme", NoteColor.Green);
    activeTag.value = "work/clients";

    await renameTag("work", "job");

    expect(tagsOf("acme")).toEqual(["job/clients/acme"]);
    expect(tagsOf("both")).toEqual(["job", "job/clients"]);
    expect(tagsOf("shop")).toEqual(["workshop"]);
    expect(hiddenTags.value).toEqual(["job/clients"]);
    expect(tagColors.value).toEqual({ "job/clients/acme": "green" });
    expect(activeTag.value).toBe("job/clients");
  });

  it("moves a tag under another by renaming it", async () => {
    await renameTag("workshop", "work/shop");
    expect(tagsOf("shop")).toEqual(["work/shop"]);
    expect(childTags("work")).toEqual(["work/clients", "work/shop"]);
  });

  it("merges into a tag a note already has, once", async () => {
    await renameTag("work/clients", "work");
    expect(tagsOf("both")).toEqual(["work"]);
    expect(tagsOf("acme")).toEqual(["work/acme"]);
  });

  it("deletes the tags under a deleted tag, and forgets what was set", async () => {
    setTagHidden("work/clients", true);
    setTagColor("work", NoteColor.Red);
    activeTag.value = "work/clients/acme";

    await deleteTag("work");

    expect(tagsOf("acme")).toEqual([]);
    expect(tagsOf("both")).toEqual([]);
    expect(tagsOf("shop")).toEqual(["workshop"]);
    expect(hiddenTags.value).toEqual([]);
    expect(tagColors.value).toEqual({});
    expect(activeTag.value).toBeNull();
  });
});
