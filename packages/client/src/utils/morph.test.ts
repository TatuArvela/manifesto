import { describe, expect, it } from "vitest";
import {
  isMorphSource,
  morphClip,
  morphFrame,
  pathFrames,
  shownRect,
} from "./morph.ts";

const card = { left: 40, top: 300, width: 200, height: 200 };
const editor = { left: 100, top: 50, width: 800, height: 400 };

describe("morphClip", () => {
  it("clips an element down to a rectangle inside it", () => {
    const to = { left: 0, top: 0, width: 375, height: 700 };
    const inner = { left: 16, top: 200, width: 164, height: 120 };
    expect(morphClip(inner, to, "4px")).toBe(
      "inset(200px 195px 380px 16px round 4px)",
    );
  });

  it("keeps the radius on the screen for a scaled element", () => {
    expect(morphClip(editor, editor, "4px", 0.5)).toBe(
      "inset(0px 0px 0px 0px round calc(4px / 0.5))",
    );
  });
});

describe("morphFrame", () => {
  // Two factors squashed the text of the note, and a fade hid that.
  it("scales by one factor and clips what does not fit", () => {
    expect(morphFrame(card, editor, false, "4px")).toEqual({
      transform: "translate(-60px, 250px) scale(0.5)",
      // 200 / 0.5 = 400 of the 800 wide panel: its right half is cut.
      clipPath: "inset(0px 400px 0px 0px round calc(4px / 0.5))",
    });
  });

  it("draws the element as it is over its own rectangle", () => {
    expect(morphFrame(editor, editor, false, "4px")).toEqual({
      transform: "translate(0px, 0px) scale(1)",
      clipPath: "inset(0px 0px 0px 0px round 4px)",
    });
  });

  it("only uncovers the editor of a phone, and does not scale it", () => {
    const screen = { left: 0, top: 0, width: 375, height: 700 };
    expect(morphFrame(card, screen, true, "4px")).toEqual({
      clipPath: morphClip(card, screen, "4px"),
    });
  });
});

describe("pathFrames", () => {
  it("draws the straight line from the card to the panel", () => {
    const frames = pathFrames(
      { start: card, end: editor, layout: editor, startAt: 0 },
      false,
      "0px",
    );
    expect(frames[0]).toMatchObject(morphFrame(card, editor, false, "0px"));
    expect(frames.at(-1)).toMatchObject(
      morphFrame(editor, editor, false, "0px"),
    );
    const middle = frames[frames.length >> 1];
    expect(middle?.offset).toBe(0.5);
    expect(middle).toMatchObject(
      morphFrame(shownRect(card, editor, 0.5), editor, false, "0px"),
    );
  });

  // A grow aimed again while it ran starts its new line where the panel is.
  it("stays at its start before the progress at which it starts", () => {
    const frames = pathFrames(
      { start: card, end: editor, layout: editor, startAt: 0.4 },
      false,
      "0px",
    );
    const [first, second] = frames;
    expect(first?.offset).toBe(0);
    expect(second?.offset).toBe(0.4);
    expect(first?.transform).toBe(second?.transform);
    expect(frames.at(-1)?.offset).toBe(1);
  });

  it("fades in a panel that is not opaque over the first part", () => {
    const frames = pathFrames(
      { start: card, end: editor, layout: editor, startAt: 0 },
      false,
      "0px",
      (offset) => Math.min(1, offset / 0.3),
    );
    expect(frames[0]?.opacity).toBe(0);
    expect(frames.at(-1)?.opacity).toBe(1);
  });
});

describe("isMorphSource", () => {
  const viewport = { width: 1000, height: 800 };

  it("accepts a card on screen, even partly", () => {
    expect(
      isMorphSource({ left: 10, top: 700, width: 200, height: 300 }, viewport),
    ).toBe(true);
  });

  it("rejects a card scrolled out of sight", () => {
    expect(
      isMorphSource({ left: 10, top: 900, width: 200, height: 300 }, viewport),
    ).toBe(false);
    expect(
      isMorphSource({ left: 10, top: -400, width: 200, height: 300 }, viewport),
    ).toBe(false);
  });

  it("rejects nothing to morph from", () => {
    expect(isMorphSource(null, viewport)).toBe(false);
    expect(
      isMorphSource({ left: 10, top: 10, width: 0, height: 0 }, viewport),
    ).toBe(false);
  });
});
