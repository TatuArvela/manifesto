import { describe, expect, it } from "vitest";
import { hexToOklch, maxChroma, oklchToLinearSrgb } from "./oklch.ts";
import {
  customDarkTint,
  customLightTint,
  DARK_HUES,
  darkTint,
  LIGHT_HUES,
  lightTint,
  MAX_DARK_CUSTOM_CHROMA,
  MAX_DARK_DIM,
  MAX_LIGHT_DIM,
  shadeColor,
} from "./themeShades.ts";

describe("hexToOklch", () => {
  it("reads white, black and a gray with no chroma", () => {
    expect(hexToOklch("#ffffff")[0]).toBeCloseTo(1, 3);
    expect(hexToOklch("#000000")[0]).toBeCloseTo(0, 3);
    expect(hexToOklch("#808080")[1]).toBeLessThan(1e-3);
  });

  it("goes back to the same sRGB color", () => {
    const linear = oklchToLinearSrgb(hexToOklch("#3b82f6"));
    const [r = 0, g = 0, b = 0] = linear.map((v) =>
      Math.round(
        255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055),
      ),
    );
    expect([r, g, b]).toEqual([0x3b, 0x82, 0xf6]);
  });
});

describe("maxChroma", () => {
  it("is zero at white, and more for yellow than blue when light", () => {
    expect(maxChroma(1, 100)).toBeLessThan(1e-3);
    expect(maxChroma(0.94, 100)).toBeGreaterThan(maxChroma(0.94, 255));
  });
});

describe("the shades", () => {
  it("has a tint for each shade in each list", () => {
    for (const hue of LIGHT_HUES) {
      expect(lightTint(hue, "#f4ecdc").dim).toBeLessThanOrEqual(MAX_LIGHT_DIM);
    }
    for (const hue of DARK_HUES) {
      expect(darkTint(hue, "#1f2333").dim).toBeLessThanOrEqual(MAX_DARK_DIM);
    }
  });

  it("names the preset color of a pale and a vivid shade, and nothing else", () => {
    expect(shadeColor("teal")).toBe("teal");
    expect(shadeColor("vivid-teal")).toBe("teal");
    expect(shadeColor("white")).toBeNull();
    expect(shadeColor("custom")).toBeNull();
  });

  it("gives a vivid shade more chroma than the pale shade of its color", () => {
    for (const color of ["red", "yellow", "blue"] as const) {
      const pale = lightTint(color, "#ffffff");
      const vivid = lightTint(`vivid-${color}`, "#ffffff");
      expect(vivid.dim).toBeGreaterThan(pale.dim);
      expect(vivid.chroma).toBeGreaterThan(
        Math.min(pale.chroma, maxChroma(1 - pale.dim / 100, pale.hue)),
      );
    }
  });
});

describe("customLightTint", () => {
  it("keeps white as white", () => {
    expect(customLightTint("#ffffff")).toEqual({ chroma: 0, hue: 0, dim: 0 });
  });

  it("caps the dim of a dark pick, and keeps the page color in gamut", () => {
    const tint = customLightTint("#cc0000");
    expect(tint.dim).toBe(MAX_LIGHT_DIM);
    expect(tint.chroma).toBeGreaterThan(0);
    expect(tint.chroma).toBeLessThanOrEqual(
      maxChroma(1 - tint.dim / 100, tint.hue) + 1e-4,
    );
    expect(tint.hue).toBeGreaterThan(20);
    expect(tint.hue).toBeLessThan(35);
  });
});

describe("customDarkTint", () => {
  it("dims to black from a black pick", () => {
    expect(customDarkTint("#000000").dim).toBe(MAX_DARK_DIM);
  });

  it("does not dim from a pick lighter than the page", () => {
    expect(customDarkTint("#6b5b95").dim).toBe(0);
  });

  it("caps the chroma of a saturated pick", () => {
    expect(customDarkTint("#ff00ff").chroma).toBeLessThanOrEqual(
      MAX_DARK_CUSTOM_CHROMA,
    );
  });

  it("dims part of the way from a pick between", () => {
    const { dim } = customDarkTint("#0d1020");
    expect(dim).toBeGreaterThan(0);
    expect(dim).toBeLessThan(MAX_DARK_DIM);
  });
});
