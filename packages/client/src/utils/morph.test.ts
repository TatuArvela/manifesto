import { describe, expect, it } from "vitest";
import { isMorphSource, morphFrames, pathFrames, shownRect } from "./morph.ts";

const card = { left: 40, top: 300, width: 200, height: 200 };
const editor = { left: 100, top: 50, width: 800, height: 400 };

/** The two scale factors in a transform, `scale(x, y)`. */
function scales(transform: unknown): [number, number] {
  const match = /scale\(([\d.e-]{1,30}), ([\d.e-]{1,30})\)/.exec(
    String(transform),
  );
  return [Number(match?.[1]), Number(match?.[2])];
}

describe("morphFrames", () => {
  it("moves and scales the panel onto the card", () => {
    expect(morphFrames(card, editor, 0, 0).panel).toEqual({
      transform: "translate(-60px, 250px) scale(0.25, 0.5)",
    });
  });

  // A scale of the text made it small at the start and large again.
  it("scales the content back, so that the text keeps its size", () => {
    expect(morphFrames(card, editor, 0, 0).content).toEqual({
      transform: "scale(4, 2) translate(0px, 0px)",
    });
  });

  it("keeps the corners round on the screen", () => {
    expect(morphFrames(card, editor, 8, 0).corners).toEqual({
      borderRadius: "32px / 16px",
    });
    // Not in the animation of the transform, which then could not run on the
    // compositor.
    expect(morphFrames(card, editor, 8, 0).panel.borderRadius).toBeUndefined();
    expect(morphFrames(card, editor, 0, 0).corners).toBeNull();
  });

  // The clip of the panel resets its scroll. A long note that closes from
  // halfway down would jump to its top.
  it("keeps the scroll of the panel in the content", () => {
    expect(morphFrames(editor, editor, 0, 120).content.transform).toBe(
      "scale(1, 1) translate(0px, -120px)",
    );
  });
});

describe("pathFrames", () => {
  const path = { start: card, end: editor, layout: editor, startAt: 0 };

  it("draws the straight line from the card to the panel", () => {
    const { panel, content } = pathFrames(path, 0, 0);
    expect(panel).toHaveLength(content.length);
    expect(panel[0]).toMatchObject(morphFrames(card, editor, 0, 0).panel);
    expect(panel.at(-1)).toMatchObject(morphFrames(editor, editor, 0, 0).panel);
    // Each point is on the line.
    for (const frame of panel) {
      const along = Number(frame.offset);
      expect(frame).toMatchObject(
        morphFrames(shownRect(card, editor, along), editor, 0, 0).panel,
      );
    }
  });

  // Between two points, both scales change linearly, and their product is
  // not exactly 1. The text must not visibly breathe.
  it("keeps the size of the content within 0.1% between its points", () => {
    const { panel, content } = pathFrames(path, 0, 0);
    for (let i = 0; i + 1 < panel.length; i++) {
      const [ax, ay] = scales(panel[i]?.transform);
      const [bx, by] = scales(panel[i + 1]?.transform);
      const [cx, cy] = scales(content[i]?.transform);
      const [dx, dy] = scales(content[i + 1]?.transform);
      const x = ((ax + bx) / 2) * ((cx + dx) / 2);
      const y = ((ay + by) / 2) * ((cy + dy) / 2);
      expect(Math.abs(x - 1)).toBeLessThan(0.001);
      expect(Math.abs(y - 1)).toBeLessThan(0.001);
    }
  });

  // A grow aimed again while it ran starts its new line where the panel is.
  it("stays at its start before the progress at which it starts", () => {
    const { panel } = pathFrames({ ...path, startAt: 0.4 }, 0, 0);
    const [first, second] = panel;
    expect(first?.offset).toBe(0);
    expect(second?.offset).toBe(0.4);
    expect(first?.transform).toBe(second?.transform);
    expect(panel.at(-1)?.offset).toBe(1);
  });

  it("fades in a panel that is not opaque, and not its content", () => {
    const { panel, content } = pathFrames(path, 0, 0, (offset) =>
      Math.min(1, offset / 0.3),
    );
    expect(panel[0]?.opacity).toBe(0);
    expect(panel.at(-1)?.opacity).toBe(1);
    expect(content[0]?.opacity).toBeUndefined();
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
