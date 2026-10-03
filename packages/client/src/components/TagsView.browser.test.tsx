import { NoteColor } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getColorLabel, t } from "../i18n/index.js";
import { activeTag, notes, tagColors } from "../state/index.js";
import { createNoteOrFail } from "../test/testSupport.js";
import { TagsView } from "./TagsView.js";
import "../styles.css";

let host: HTMLDivElement;

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.getAttribute("aria-label") === label || el.textContent === label,
  );
}

const dots = () =>
  [...host.querySelectorAll<HTMLElement>("[data-tag-color]")].map(
    (dot) => dot.dataset.tagColor,
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

describe("a tag's colour in the Tags view", () => {
  it("is picked for the selected tag and drawn as a dot on its chip", async () => {
    expect(dots()).toEqual([]);

    button(t("tags.color"))?.click();
    await vi.waitFor(() =>
      expect(button(getColorLabel(NoteColor.Red))).toBeDefined(),
    );
    button(getColorLabel(NoteColor.Red))?.click();

    await vi.waitFor(() => expect(dots()).toEqual(["red"]));
    expect(tagColors.value).toEqual({ work: "red" });
  });

  it("is taken away with the plain swatch", async () => {
    tagColors.value = { work: NoteColor.Red };
    await vi.waitFor(() => expect(dots()).toEqual(["red"]));

    button(t("tags.color"))?.click();
    await vi.waitFor(() => expect(button(t("tags.noColor"))).toBeDefined());
    button(t("tags.noColor"))?.click();

    await vi.waitFor(() => expect(dots()).toEqual([]));
    expect(tagColors.value).toEqual({});
  });
});
