import { describe, expect, it } from "vitest";
import { isMorphSource, morphTransform } from "./morph.js";

describe("morphTransform", () => {
  it("moves and scales a laid-out rectangle onto the source", () => {
    const card = { left: 40, top: 300, width: 200, height: 100 };
    const editor = { left: 100, top: 50, width: 800, height: 400 };
    expect(morphTransform(card, editor)).toBe(
      "translate(-60px, 250px) scale(0.25, 0.25)",
    );
  });

  it("does not divide by a collapsed target", () => {
    const card = { left: 0, top: 0, width: 200, height: 100 };
    const nothing = { left: 0, top: 0, width: 0, height: 0 };
    expect(morphTransform(card, nothing)).toBe(
      "translate(0px, 0px) scale(1, 1)",
    );
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
