import { TRASH_RETENTION_DAYS } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { plural, t } from "#/i18n/index.ts";
import { activeTag } from "#/state/ui.ts";
import { EmptyBoard } from "./EmptyBoard.tsx";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  activeTag.value = null;
});

describe("EmptyBoard", () => {
  it("says what each view holds, over a drawing a screen reader skips", () => {
    const cases = [
      ["active", t("noteGrid.empty")],
      ["archived", t("empty.archive.title")],
      ["trash", t("empty.trash.title")],
      ["reminders", t("empty.reminders.title")],
      ["search", t("search.empty")],
    ] as const;
    for (const [view, title] of cases) {
      render(<EmptyBoard view={view} hiddenByTag={0} />, host);
      expect(host.textContent).toContain(title);
      expect(host.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    }
  });

  it("tells how long the trash keeps a note", () => {
    render(<EmptyBoard view="trash" hiddenByTag={0} />, host);
    expect(host.textContent).toContain(
      plural("empty.trash.hint", TRASH_RETENTION_DAYS),
    );
  });

  it("names the tag being looked at", () => {
    activeTag.value = "work";
    render(<EmptyBoard view="tags" hiddenByTag={0} />, host);
    expect(host.textContent).toContain(t("empty.tag.title", { tag: "work" }));
  });

  it("says notes are hidden by a tag rather than that there are none", () => {
    render(<EmptyBoard view="active" hiddenByTag={2} />, host);
    expect(host.textContent).toContain(plural("noteGrid.hiddenByTag", 2));
    expect(host.textContent).not.toContain(t("noteGrid.empty"));
  });
});
