// Conversions between sRGB hex and OKLCH, the space in which the shades of the
// themes are written (styles/dark-shade.css, styles/light-shade.css).

/** Lightness 0 to 1, chroma, and hue in degrees. */
export type Oklch = [lightness: number, chroma: number, hue: number];

function linear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * A six-digit hex color as OKLCH. A gray has the hue 0. The value is a
 * preference that its parser checked. Thus, a value that does not parse is
 * black, not an error.
 */
export function hexToOklch(hex: string): Oklch {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const [r, g, b] = match
    ? [match[1], match[2], match[3]].map((part) =>
        linear(Number.parseInt(part ?? "0", 16) / 255),
      )
    : [0, 0, 0];
  const lr = r ?? 0;
  const lg = g ?? 0;
  const lb = b ?? 0;
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bb);
  const hue =
    chroma < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return [lightness, chroma, hue];
}

/** OKLCH as linear sRGB, each channel in 0 to 1 when the color is in gamut. */
export function oklchToLinearSrgb([l, c, h]: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  const [x = 0, y = 0, z = 0] = lms;
  return [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ];
}

const GAMUT_EPSILON = 1e-4;

/**
 * The most chroma that sRGB can show at this lightness and hue. A color past it
 * is clipped by the browser, and the clip moves its hue. A fixed number of
 * halvings, sufficient for the third decimal of chroma.
 */
export function maxChroma(lightness: number, hue: number): number {
  let low = 0;
  let high = 0.4;
  for (let step = 0; step < 24; step++) {
    const mid = (low + high) / 2;
    const inGamut = oklchToLinearSrgb([lightness, mid, hue]).every(
      (v) => v >= -GAMUT_EPSILON && v <= 1 + GAMUT_EPSILON,
    );
    if (inGamut) low = mid;
    else high = mid;
  }
  return low;
}
