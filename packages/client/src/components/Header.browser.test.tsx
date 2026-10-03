import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { plural, t } from "../i18n/index.js";
import {
  enterSelectMode,
  exitSelectMode,
  notes,
  selectedNotes,
  selectMode,
} from "../state/index.js";
import { createNoteOrFail } from "../test/testSupport.js";
import { Header } from "./Header.js";
import "../styles.css";

let host: HTMLDivElement;

/** Preact rerenders on a microtask, so read the DOM only after one. */
async function settled() {
  await Promise.resolve();
  await Promise.resolve();
}

function bar() {
  return host.querySelector<HTMLElement>(".selection-bar");
}

function mainHeader() {
  return host.querySelector<HTMLElement>("header");
}

beforeEach(() => {
  exitSelectMode();
  host = document.createElement("div");
  document.body.appendChild(host);
  render(<Header />, host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("the selection bar", () => {
  it("covers the header while notes are selected", async () => {
    enterSelectMode("a");
    selectedNotes.value = new Set(["a", "b"]);
    await settled();

    expect(bar()?.textContent).toContain(plural("selection.count", 2));
    expect(mainHeader()?.inert).toBe(true);
  });

  it("fades out onto the header instead of vanishing", async () => {
    enterSelectMode("a");
    selectedNotes.value = new Set(["a", "b"]);
    await settled();

    exitSelectMode();
    await settled();

    // Still there, leaving, and still saying what was selected rather than
    // the empty selection that exiting leaves behind.
    expect(bar()?.dataset.leaving).toBe("true");
    expect(bar()?.textContent).toContain(plural("selection.count", 2));
    // The header underneath is usable at once.
    expect(mainHeader()?.inert).toBe(false);

    await vi.waitFor(() => expect(bar()).toBeNull());
  });

  it("comes back if select mode is re-entered while it fades", async () => {
    enterSelectMode("a");
    await settled();
    exitSelectMode();
    await settled();
    enterSelectMode("b");
    await settled();

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(bar()).not.toBeNull();
    expect(bar()?.dataset.leaving).toBeUndefined();
  });

  describe("tag panel", () => {
    beforeEach(() => {
      localStorage.clear();
      notes.value = [];
    });

    afterEach(() => {
      localStorage.clear();
      notes.value = [];
    });

    function row(tag: string) {
      return [
        ...document.querySelectorAll<HTMLElement>('[role="checkbox"]'),
      ].find((el) => el.textContent === `#${tag}`);
    }

    it("shows what the selection carries and toggles a tag across it", async () => {
      const a = await createNoteOrFail({ title: "A", tags: ["both", "one"] });
      const b = await createNoteOrFail({ title: "B", tags: ["both"] });
      await createNoteOrFail({ title: "C", tags: ["other", "both"] });
      enterSelectMode(a.id);
      selectedNotes.value = new Set([a.id, b.id]);
      await settled();

      host
        .querySelector<HTMLElement>(
          `[aria-label="${t("selection.tagSelected")}"]`,
        )
        ?.click();
      await settled();

      expect(row("both")?.getAttribute("aria-checked")).toBe("true");
      expect(row("one")?.getAttribute("aria-checked")).toBe("mixed");
      expect(row("other")?.getAttribute("aria-checked")).toBe("false");

      row("one")?.click();
      await vi.waitFor(() =>
        expect(row("one")?.getAttribute("aria-checked")).toBe("true"),
      );
      row("both")?.click();
      await vi.waitFor(() =>
        expect(row("both")?.getAttribute("aria-checked")).toBe("false"),
      );

      const tagsOf = (id: string) => notes.value.find((n) => n.id === id)?.tags;
      expect(tagsOf(a.id)).toEqual(["one"]);
      expect(tagsOf(b.id)).toEqual(["one"]);
      // Still selecting, with the panel open for the next tag.
      expect(selectMode.value).toBe(true);
      expect(row("other")).toBeDefined();
    });
  });
});
