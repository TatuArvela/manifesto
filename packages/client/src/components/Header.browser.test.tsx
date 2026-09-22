import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { plural } from "../i18n/index.js";
import {
  enterSelectMode,
  exitSelectMode,
  selectedNotes,
} from "../state/index.js";
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
});
