import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { activeView, noteQuips, notes } from "../state/index.js";
import { NoteInput } from "./NoteInput.js";

/**
 * `noteQuips` was persisted and never read: the setting saved, survived a
 * reload and changed nothing, because the composer's stack always drew from
 * the rotation. `cta.plain` sat in both catalogues with no caller.
 */

let host: HTMLDivElement;

/** The two sheets of the stack: the top one and the one showing behind it. */
function stackLines(): string[] {
  return [...host.querySelectorAll(".note-stack > div > div > div")].map(
    (el) => el.textContent?.trim() ?? "",
  );
}

describe("NoteInput quips", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    activeView.value = "active";
    noteQuips.value = true;
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    noteQuips.value = true;
  });

  it("draws the stack from the quip rotation while the preference is on", () => {
    render(<NoteInput />, host);
    const lines = stackLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines).not.toContain(t("cta.plain"));
  });

  it("shows the plain line on both sheets with the preference off", () => {
    noteQuips.value = false;
    render(<NoteInput />, host);
    const lines = stackLines();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toBe(t("cta.plain"));
  });

  it("switches the stack already on screen when the preference changes", () => {
    render(<NoteInput />, host);
    expect(stackLines()).not.toContain(t("cta.plain"));

    noteQuips.value = false;
    render(<NoteInput />, host);
    for (const line of stackLines()) expect(line).toBe(t("cta.plain"));
  });
});

describe("NoteInput with an empty draft", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    activeView.value = "active";
    render(<NoteInput />, host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    localStorage.clear();
    notes.value = [];
  });

  async function openEmptyDraft(): Promise<HTMLElement> {
    (host.querySelector(".note-stack") as HTMLElement).click();
    return await vi.waitFor(() => {
      const done = document.querySelector<HTMLElement>(
        `[role="dialog"] button[aria-label="${t("editor.done")}"]`,
      );
      expect(done).toBeTruthy();
      return done as HTMLElement;
    });
  }

  it("adds an empty note when Done is pressed", async () => {
    // Done is an explicit request for a note; an empty one used to be
    // discarded as silently as a pad opened by accident.
    const done = await openEmptyDraft();
    done.click();
    await vi.waitFor(() => expect(notes.value).toHaveLength(1));
    expect(notes.value[0]).toMatchObject({ title: "", content: "" });
  });

  it("still discards an empty draft closed with Escape", async () => {
    await openEmptyDraft();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    expect(notes.value).toHaveLength(0);
  });
});
