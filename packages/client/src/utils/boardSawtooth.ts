import { dataUrl, round } from "./boardSvg.ts";

/**
 * The sawtooth is the logo itself, in rows turned 45° up from level. Its
 * 1080-unit square is put edge to edge. Thus, its notches make teeth along both
 * sides of each row. Between the rows, there is a line approximately as wide as
 * the stroke of the logo, with the notches as barbs on it, as on barbed wire.
 * The logo repeats each 540 units along a row.
 *
 * A turned pattern repeats on a level tile only when a move across it and a
 * move down it both end on whole teeth and whole rows. At 45°, that needs rows
 * a whole fraction of a tooth apart. Five halves of one makes the line 270
 * units wide, against the 253.622 of the straight columns of the logo, and
 * repeats each 5 teeth and 2 rows: a tile 2700√2 units square, drawn at 81px a
 * logo as 286px. Each row is one path. Thus, no seam shows in it.
 */
const SAWTOOTH_TURN = -45;

const SAWTOOTH_TOOTH = 540;

const SAWTOOTH_ROW = (SAWTOOTH_TOOTH * 5) / 2;

const SAWTOOTH_UNITS = {
  width: 5 * SAWTOOTH_TOOTH * Math.SQRT2,
  height: 5 * SAWTOOTH_TOOTH * Math.SQRT2,
} as const;

export const SAWTOOTH_TILE = { width: 286, height: 286 } as const;

/**
 * One tooth of the logo along the top edge of a row, then back along its
 * bottom.
 */
const TOOTH_TOP = "l286.378-286.378h253.622v286.378";

const TOOTH_FOOT = "h-253.622v-286.378l-286.378 286.378";

/**
 * Every row that crosses the tile, as one long row drawn once and placed
 * again at each row's offset, all turned together. The rows' reach is the
 * tile's corners measured along and across them, with a tooth and a row to
 * spare at each end, and starts on a whole tooth so the rows stay in step.
 */
export function drawSawtooth(parity?: 0 | 1): string {
  const turn = (SAWTOOTH_TURN * Math.PI) / 180;
  const { width, height } = SAWTOOTH_UNITS;
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ] as const;
  const along = corners.map(
    ([x, y]) => x * Math.cos(turn) + y * Math.sin(turn),
  );
  const across = corners.map(
    ([x, y]) => -x * Math.sin(turn) + y * Math.cos(turn),
  );
  const first = Math.floor(Math.min(...along) / SAWTOOTH_TOOTH) - 1;
  const teeth = Math.ceil(Math.max(...along) / SAWTOOTH_TOOTH) + 1 - first;
  const firstRow = Math.floor(Math.min(...across) / SAWTOOTH_ROW) - 2;
  const lastRow = Math.ceil(Math.max(...across) / SAWTOOTH_ROW) + 1;
  const row = `M${first * SAWTOOTH_TOOTH} 286.378${TOOTH_TOP.repeat(teeth)}v793.622${TOOTH_FOOT.repeat(teeth)}Z`;
  const rows: string[] = [];
  for (let n = firstRow; n <= lastRow; n++) {
    if (parity !== undefined && ((n % 2) + 2) % 2 !== parity) continue;
    rows.push(`<use href='#r' y='${round(n * SAWTOOTH_ROW)}'/>`);
  }
  return dataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${SAWTOOTH_TILE.width}' height='${SAWTOOTH_TILE.height}' viewBox='0 0 ${width} ${round(height)}' preserveAspectRatio='none'><defs><path id='r' d='${row}'/></defs><g transform='rotate(${SAWTOOTH_TURN})'>${rows.join("")}</g></svg>`,
  );
}
