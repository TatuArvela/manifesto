import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFETTI_TILE, SAWTOOTH_TILE } from "../utils/boardTextures.js";

// Read from disk: Vitest blanks a stylesheet imported in a test, `?raw` too.
const css = readFileSync(new URL("./preferences.css", import.meta.url), "utf8");

/** Splits a CSS value on its top-level commas, as a layer list is. */
function layers(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

describe("board textures", () => {
  // The board lays its gradient under the texture with one more size,
  // `100% 100%`. A texture listing fewer sizes than layers has its list
  // cycle, and the gradient takes the texture's tile size and repeats.
  const sizes = new Map(
    [...css.matchAll(/--board-texture-([a-z]+)-size:\s*([^;]+);/g)].map(
      ([, name = "", value = ""]) => [name, value],
    ),
  );
  const textures = [
    ...css.matchAll(/--board-texture-([a-z]+):\s*([^;]+);/g),
  ].filter(([, name = ""]) => sizes.has(name));

  it("finds the textures to check", () => {
    expect(textures.map(([, name]) => name)).toContain("grid");
  });

  it.each(textures.map(([, name = "", value = ""]) => [name, value] as const))(
    "lists one size per layer for %s",
    (name, value) => {
      expect(layers(sizes.get(name) ?? "")).toHaveLength(layers(value).length);
    },
  );

  it("tiles confetti at the size it is drawn on", () => {
    expect(sizes.get("confetti")?.trim()).toBe(
      `${CONFETTI_TILE}px ${CONFETTI_TILE}px`,
    );
  });

  it("tiles the sawtooth at the size it is drawn on", () => {
    expect(sizes.get("sawtooth")?.trim()).toBe(
      `${SAWTOOTH_TILE.width}px ${SAWTOOTH_TILE.height}px`,
    );
  });
});
