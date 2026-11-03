/**
 * The helpers that the masks of the board patterns share: the numbers, the
 * seeded generator, the distance around a tile, and the SVG as a CSS `url()`.
 */

/** A number to three places, which is sufficient for a mask. */
export const round = (n: number) => Number(n.toFixed(3));

/**
 * A small seeded generator. Thus, each scattered pattern falls in the same way
 * on each load.
 */
export function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The shortest signed distance from `b` to `a` along one axis of a tile. */
export function across(a: number, b: number, tile: number): number {
  return ((((a - b + tile / 2) % tile) + tile) % tile) - tile / 2;
}

export function dataUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function svg(width: number, height: number, body: string): string {
  return dataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>${body}</svg>`,
  );
}
