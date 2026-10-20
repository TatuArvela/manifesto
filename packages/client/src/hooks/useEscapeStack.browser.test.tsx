import type { ComponentChildren } from "preact";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeStackDepth, useEscapeStack } from "./useEscapeStack.ts";

/**
 * The purpose of the stack is that one Escape reaches exactly one layer. Thus,
 * each test here pushes Escape with many layers registered, and checks which
 * one moved. Real key events on a real document: the bug that it replaces was
 * many document listeners that all fired, which a test of one handler alone
 * cannot show.
 *
 * Layers open one render at a time, as the app opens them: a click on the
 * editor opens the picker over it. See the note of the hook about why a layer
 * must not become active in the same render as a layer that contains it.
 */

let host: HTMLDivElement;

function Layer({
  active = true,
  onEscape,
  passThrough = false,
}: {
  active?: boolean;
  onEscape: () => void;
  passThrough?: boolean;
}) {
  useEscapeStack(active, onEscape, { passThrough });
  return null;
}

const pressEscape = () =>
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

/**
 * The registration is a layout effect. Thus, after a render the stack is
 * stable.
 */
const show = (tree: ComponentChildren) => render(tree, host);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  show(null);
  host.remove();
  // The stack is module state. A leak here would take Escape from each later
  // test.
  expect(escapeStackDepth()).toBe(0);
});

describe("useEscapeStack", () => {
  it("delivers a press to the layer that opened last", () => {
    const editor = vi.fn();
    const picker = vi.fn();

    show(<Layer onEscape={editor} />);
    show(
      <>
        <Layer onEscape={editor} />
        <Layer onEscape={picker} />
      </>,
    );

    pressEscape();

    // The reported bug in one assertion: a color picker open over the editor
    // dismissed itself *and* closed the editor on the same key press.
    expect(picker).toHaveBeenCalledTimes(1);
    expect(editor).not.toHaveBeenCalled();
  });

  it("lets a pass-through layer hand the same press on", () => {
    // A tooltip over the editor: Escape removes it and still closes the editor.
    // Thus, a keyboard user does not need a second press.
    const editor = vi.fn();
    const tooltip = vi.fn();

    show(<Layer onEscape={editor} />);
    show(
      <>
        <Layer onEscape={editor} />
        <Layer onEscape={tooltip} passThrough />
      </>,
    );

    pressEscape();

    expect(tooltip).toHaveBeenCalledTimes(1);
    expect(editor).toHaveBeenCalledTimes(1);
  });

  it("hands the key back to the layer below once the top leaves", () => {
    const editor = vi.fn();
    const picker = vi.fn();
    const tree = (pickerOpen: boolean) => (
      <>
        <Layer onEscape={editor} />
        {pickerOpen && <Layer onEscape={picker} />}
      </>
    );

    show(tree(false));
    show(tree(true));
    pressEscape();
    expect(picker).toHaveBeenCalledTimes(1);

    show(tree(false));
    pressEscape();
    expect(editor).toHaveBeenCalledTimes(1);
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it("puts a layer that reactivates back on top", () => {
    // A dropdown stays mounted for the life of its trigger, and moves in and
    // out of the stack with `open`. Thus, when it opens again, it must outrank
    // the modal that registered while it was closed.
    const modal = vi.fn();
    const dropdown = vi.fn();
    const tree = (open: boolean) => (
      <>
        <Layer active={open} onEscape={dropdown} />
        <Layer onEscape={modal} />
      </>
    );

    show(tree(false));
    pressEscape();
    expect(modal).toHaveBeenCalledTimes(1);

    show(tree(true));
    pressEscape();
    expect(dropdown).toHaveBeenCalledTimes(1);
    expect(modal).toHaveBeenCalledTimes(1);
  });

  it("keeps a layer's position when its handler changes identity", () => {
    // Handlers close over state. Thus, they are new functions on each render. A
    // new registration of one would silently move it above all layers opened
    // since.
    const bottom = vi.fn();
    const top = vi.fn();
    const tree = (tick: number, topOpen: boolean) => (
      <>
        <Layer onEscape={() => bottom(tick)} />
        {topOpen && <Layer onEscape={() => top(tick)} />}
      </>
    );

    show(tree(1, false));
    show(tree(1, true));
    show(tree(2, true));
    pressEscape();

    expect(top).toHaveBeenCalledWith(2);
    expect(bottom).not.toHaveBeenCalled();
  });

  it("ignores keys that are not Escape", () => {
    const onEscape = vi.fn();
    show(<Layer onEscape={onEscape} />);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    expect(onEscape).not.toHaveBeenCalled();
  });

  it("unbinds the document listener when the last layer leaves", () => {
    const onEscape = vi.fn();
    show(<Layer onEscape={onEscape} />);
    expect(escapeStackDepth()).toBe(1);

    show(null);
    expect(escapeStackDepth()).toBe(0);

    pressEscape();
    expect(onEscape).not.toHaveBeenCalled();
  });
});
