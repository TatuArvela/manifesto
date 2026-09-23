import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cardAfterFocused,
  focusedNoteId,
  moveCardFocus,
} from "../utils/cardFocus.js";
import { useShortcut } from "./useShortcut.js";

let host: HTMLDivElement;

function Binder({ keyName, run }: { keyName: string; run: () => void }) {
  useShortcut(keyName, run);
  return null;
}

function press(key: string, target: EventTarget = document.body, init = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("useShortcut", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it("runs the binding on the board and claims the key", () => {
    const run = vi.fn();
    render(<Binder keyName="c" run={run} />, host);
    const event = press("c");
    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("stands aside while typing", () => {
    const run = vi.fn();
    render(<Binder keyName="c" run={run} />, host);
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    host.append(input, editable);
    press("c", input);
    press("c", editable);
    expect(run).not.toHaveBeenCalled();
  });

  it("stands aside while a dialog is open", () => {
    const run = vi.fn();
    render(<Binder keyName="c" run={run} />, host);
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    host.append(dialog);
    press("c");
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves modified keys to the browser", () => {
    const run = vi.fn();
    render(<Binder keyName="c" run={run} />, host);
    press("c", document.body, { ctrlKey: true });
    press("c", document.body, { metaKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const run = vi.fn();
    render(<Binder keyName="c" run={run} />, host);
    render(null, host);
    press("c");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("card focus", () => {
  beforeEach(() => {
    host = document.createElement("div");
    host.innerHTML = ["a", "b", "c"]
      .map(
        (id) =>
          `<div data-note-id="${id}"><div data-note-card tabindex="0">${id}</div></div>`,
      )
      .join("");
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  it("starts at the first card and moves both ways within bounds", () => {
    moveCardFocus(-1);
    expect(focusedNoteId()).toBe("a");
    moveCardFocus(1);
    moveCardFocus(1);
    moveCardFocus(1);
    expect(focusedNoteId()).toBe("c");
    moveCardFocus(-1);
    expect(focusedNoteId()).toBe("b");
  });

  it("names the neighbour to take focus when a card leaves", () => {
    moveCardFocus(1);
    expect(cardAfterFocused()?.textContent).toBe("b");
    moveCardFocus(1);
    moveCardFocus(1);
    expect(cardAfterFocused()?.textContent).toBe("b");
  });
});
