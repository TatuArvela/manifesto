import { describe, expect, it } from "vitest";
import { parseShadow, shadowAt } from "./morphShadow.ts";

describe("parseShadow", () => {
  it("reads each layer of a computed shadow", () => {
    expect(
      parseShadow(
        "rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, rgb(255, 255, 255) 0px 1px 2px 0px inset",
      ),
    ).toEqual([
      {
        color: "rgba(0, 0, 0, 0.1)",
        x: 0,
        y: 10,
        blur: 15,
        spread: -3,
        inset: false,
      },
      {
        color: "rgb(255, 255, 255)",
        x: 0,
        y: 1,
        blur: 2,
        spread: 0,
        inset: true,
      },
    ]);
  });

  // Tailwind puts four empty layers in front of each shadow.
  it("leaves out the layers that draw nothing", () => {
    expect(
      parseShadow(
        "rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0.1) 0px 4px 6px -4px",
      ),
    ).toHaveLength(1);
  });

  it("reads no layers from none", () => {
    expect(parseShadow("none")).toEqual([]);
  });
});

describe("shadowAt", () => {
  const layers = parseShadow("rgba(0, 0, 0, 0.1) 2px 10px 15px -3px");

  it("divides the lengths by the scale", () => {
    expect(shadowAt({ from: layers, to: layers }, 0.5, 0.5, 0.5)).toBe(
      "4px 20px 30px -6px rgba(0, 0, 0, 0.1)",
    );
  });

  it("is null with no shadow at either end", () => {
    expect(shadowAt({ from: [], to: [] }, 0.5, 1, 1)).toBeNull();
  });

  it("mixes the two ends by the progress", () => {
    expect(shadowAt({ from: layers, to: [] }, 0.25, 1, 1)).toBe(
      "2px 10px 15px -3px color-mix(in srgb, rgba(0, 0, 0, 0.1) 75%, transparent)",
    );
  });
});
