/**
 * The shadow of a panel while it morphs (`utils/morph.ts`). The panel is drawn
 * with a scale, and a scale changes its shadow too: the shadow of a panel drawn
 * at a quarter of its width is a quarter as wide. Thus, each keyframe divides
 * the lengths of the shadow by the scale of that keyframe, as it does for the
 * corners.
 *
 * The shadow also goes from the shadow of the card to the shadow of the panel.
 * The two can have a different number of layers. Thus, each keyframe has the
 * layers of both, and each layer has its color at a part of its strength: the
 * layers of the card go out as the layers of the panel come in. Each keyframe
 * has the same list of layers. Thus, the browser can interpolate between two
 * keyframes.
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

/**
 * The shadow of a morph from its start to its end. A shadow that does not
 * change has the same list at both ends.
 */
export interface ShadowPath {
  from: ShadowLayer[];
  to: ShadowLayer[];
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

/**
 * The `box-shadow` at `progress` along `path`, for a panel drawn with the scale
 * `scaleX`, `scaleY`. Thus, on the screen it has its own size. The blur and the
 * spread have one length for both axes, and take the mean of the two scales.
 * Null when there is no shadow at either end.
 */
export function shadowAt(
  path: ShadowPath,
  progress: number,
  scaleX: number,
  scaleY: number,
): string | null {
  const mean = Math.sqrt(scaleX * scaleY);
  const layer = (shadow: ShadowLayer, strength: number) =>
    [
      shadow.inset ? "inset" : "",
      `${shadow.x / scaleX}px`,
      `${shadow.y / scaleY}px`,
      `${shadow.blur / mean}px`,
      `${shadow.spread / mean}px`,
      strength >= 1
        ? shadow.color
        : `color-mix(in srgb, ${shadow.color} ${Math.max(0, strength) * 100}%, transparent)`,
    ]
      .filter((token) => token !== "")
      .join(" ");
  const layers =
    path.from === path.to
      ? path.to.map((shadow) => layer(shadow, 1))
      : [
          ...path.from.map((shadow) => layer(shadow, 1 - progress)),
          ...path.to.map((shadow) => layer(shadow, progress)),
        ];
  return layers.length > 0 ? layers.join(", ") : null;
}
