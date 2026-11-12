/**
 * The shadows of a morph (`utils/morph.ts`) are boxes with the computed
 * `box-shadow` of the card and of the panel (`utils/morphPlates.ts`). This
 * reads such a value, to know if it draws anything.
 */

/** One layer of a `box-shadow`, with its lengths in pixels. */
export interface ShadowLayer {
  color: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
  inset: boolean;
}

/** Splits `value` at each `separator` that is not inside parentheses. */
function splitTop(value: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === separator && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** A length of a computed style (`12px`, or `0`), or null for a different token. */
function pixels(token: string): number | null {
  if (token !== "0" && !token.endsWith("px")) return null;
  const number = Number.parseFloat(token);
  return Number.isFinite(number) ? number : null;
}

/**
 * The layers of a computed `box-shadow`. A layer with no offset, blur or
 * spread draws nothing, and goes. Tailwind puts four of those in front of each
 * shadow.
 */
export function parseShadow(value: string): ShadowLayer[] {
  if (value === "none") return [];
  const layers: ShadowLayer[] = [];
  for (const part of splitTop(value, ",")) {
    const lengths: number[] = [];
    const color: string[] = [];
    let inset = false;
    for (const token of splitTop(part, " ")) {
      const length = pixels(token);
      if (token === "inset") inset = true;
      else if (length !== null) lengths.push(length);
      else color.push(token);
    }
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    if (x === 0 && y === 0 && blur === 0 && spread === 0) continue;
    layers.push({
      color: color.join(" ") || "currentcolor",
      x,
      y,
      blur,
      spread,
      inset,
    });
  }
  return layers;
}

/** If a computed `box-shadow` draws anything. */
export function drawsShadow(value: string | null | undefined): value is string {
  return Boolean(value) && parseShadow(value ?? "none").length > 0;
}
