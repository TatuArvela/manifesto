import { NoteColor } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getColorLabel, plural, t } from "../i18n/index.js";
import { activeTag, hiddenTags, notes, tagColors } from "../state/index.js";
import { createNoteOrFail } from "../test/testSupport.js";
import { TagsView } from "./TagsView.js";
import "../styles.css";

let host: HTMLDivElement;

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.getAttribute("aria-label") === label || el.textContent === label,
  );
}

const coloured = () =>
  [...host.querySelectorAll<HTMLElement>("[data-tag-color]")].map(
    (chip) => chip.dataset.tagColor,
  );

beforeEach(async () => {
  localStorage.clear();
  notes.value = [];
  tagColors.value = {};
  await createNoteOrFail({ title: "A", tags: ["work", "home"] });
  activeTag.value = "work";
  host = document.createElement("div");
  document.body.appendChild(host);
  render(<TagsView />, host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  activeTag.value = null;
  tagColors.value = {};
  notes.value = [];
  localStorage.clear();
});

describe("nested tags in the Tags view", () => {
  const groups = () =>
    [...host.querySelectorAll<HTMLElement>("[data-tags-under]")].map(
      (group) => [
        group.getAttribute("aria-label"),
        [...group.querySelectorAll("button")].map(
          (chip) => chip.getAttribute("aria-label")?.split(",")[0],
        ),
      ],
    );

  it("opens a row of the tags under each tag on the way to the selected one", async () => {
    await createNoteOrFail({ title: "B", tags: ["work/clients/acme"] });
    await createNoteOrFail({ title: "C", tags: ["work/admin"] });
    await vi.waitFor(() =>
      expect(groups()).toEqual([
        [t("tags.under", { tag: "work" }), ["#work/admin", "#work/clients"]],
      ]),
    );

    button(`#work/clients, ${plural("tags.noteCount", 1)}`)?.click();

    await vi.waitFor(() =>
      expect(groups()).toEqual([
        [t("tags.under", { tag: "work" }), ["#work/admin", "#work/clients"]],
        [t("tags.under", { tag: "work/clients" }), ["#work/clients/acme"]],
      ]),
    );
    expect(activeTag.value).toBe("work/clients");
    // Only the top row shows the whole tag.
    expect(host.textContent).toContain("#work");
    expect(host.textContent).not.toContain("#work/clients");
  });

  it("says which tag above hides a tag, in place of a button that could not show it", async () => {
    await createNoteOrFail({ title: "B", tags: ["work/clients"] });
    hiddenTags.value = ["work"];
    activeTag.value = "work/clients";

    await vi.waitFor(() =>
      expect(host.textContent).toContain(
        t("tags.hiddenByParent", { tag: "work/clients", parent: "work" }),
      ),
    );
    expect(button(t("tags.showInNotes"))).toBeUndefined();
    expect(button(t("tags.hideFromNotes"))).toBeUndefined();
    hiddenTags.value = [];
  });
});

describe("a tag's colour in the Tags view", () => {
  it("is picked for the selected tag and drawn on its chip", async () => {
    expect(coloured()).toEqual([]);

    button(t("tags.color"))?.click();
    await vi.waitFor(() =>
      expect(button(getColorLabel(NoteColor.Red))).toBeDefined(),
    );
    button(getColorLabel(NoteColor.Red))?.click();

    await vi.waitFor(() => expect(coloured()).toEqual(["red"]));
    expect(tagColors.value).toEqual({ work: "red" });
  });

  it("is taken away with the plain swatch", async () => {
    tagColors.value = { work: NoteColor.Red };
    await vi.waitFor(() => expect(coloured()).toEqual(["red"]));

    button(t("tags.color"))?.click();
    await vi.waitFor(() => expect(button(t("tags.noColor"))).toBeDefined());
    button(t("tags.noColor"))?.click();

    await vi.waitFor(() => expect(coloured()).toEqual([]));
    expect(tagColors.value).toEqual({});
  });
});
