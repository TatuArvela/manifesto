import { describe, expect, it } from "vitest";
import { drawsShadow, parseShadow } from "./morphShadow.ts";

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

describe("drawsShadow", () => {
  it("is true for a shadow with a layer that draws", () => {
    expect(drawsShadow("rgba(0, 0, 0, 0.1) 0px 10px 15px -3px")).toBe(true);
  });

  // A panel on a phone has no shadow, and needs no plate for it.
  it("is false for none, an empty value, or only empty layers", () => {
    expect(drawsShadow("none")).toBe(false);
    expect(drawsShadow("")).toBe(false);
    expect(drawsShadow(undefined)).toBe(false);
    expect(drawsShadow("rgba(0, 0, 0, 0) 0px 0px 0px 0px")).toBe(false);
  });
});
