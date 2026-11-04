import { CONFETTI, CONFETTI_TILE, drawConfetti } from "./boardConfetti.ts";
import { drawFrames, FRAMES, FRAMES_TILE } from "./boardFrames.ts";
import { drawSawtooth, SAWTOOTH_TILE } from "./boardSawtooth.ts";
import {
  drawScatter,
  LEAF_TILE,
  SCATTER_TILE,
  SCATTERS,
} from "./boardScatters.ts";
import { dataUrl, round, svg } from "./boardSvg.ts";

/**
 * The board textures that are pictures, not gradients: the paper grain, which
 * is SVG turbulence, and the stars, hearts, confetti, bubbles, rain, snow,
 * leaves, petals, frames and sawtooth. Each texture is a mask over one layer
 * behind the board, which takes the color of the pattern as its background, and
 * the opacity of the pattern as its own (`.board-frame::before` in
 * board-background.css). Thus, these are drawn one time, in opaque black, and
 * given to the stylesheet as they are. Only their shape is read, and neither
 * the color nor the opacity draws them again.
 */
export type PictureTexture =
  | "paper"
  | "stars"
  | "hearts"
  | "confetti"
  | "bubbles"
  | "rain"
  | "snow"
  | "leaves"
  | "petals"
  | "frames"
  | "sawtooth";

interface Noise {
  size: number;
  frequency: number;
  octaves: number;
}

const NOISE: Record<"paper", Noise> = {
  paper: { size: 160, frequency: 0.8, octaves: 3 },
};

/**
 * The alpha row of the color matrix of the grain: noise alpha times the slope,
 * plus the offset, which cuts away the faintest grain. The noise is
 * approximately at the middle. Thus, the grain goes from nothing to fully
 * drawn, and is half drawn on average. A mask of it, as a mask of shapes is
 * not, has all degrees.
 */
const GRAIN_SLOPE = 2;

const GRAIN_OFFSET = -0.5;

function noise(texture: Noise): string {
  const matrix = `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${GRAIN_SLOPE} ${GRAIN_OFFSET}`;
  return dataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${texture.size}' height='${texture.size}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${texture.frequency}' numOctaves='${texture.octaves}' stitchTiles='stitch'/><feColorMatrix values='${matrix}'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
  );
}

/** Every picture texture as a mask, each a CSS `url(...)`. */
export function pictureTextures(): Record<PictureTexture, string> {
  return {
    paper: noise(NOISE.paper),
    stars: drawScatter("stars"),
    hearts: drawScatter("hearts"),
    confetti: drawConfetti(),
    bubbles: drawScatter("bubbles"),
    rain: drawScatter("rain"),
    snow: drawScatter("snow"),
    leaves: drawScatter("leaves"),
    petals: drawScatter("petals"),
    frames: drawFrames(),
    sawtooth: drawSawtooth(),
  };
}

/**
 * The moving patterns (`.board-sheets` in board-motion.css). A pattern that
 * moves is split into sheets, each its own layer with its own motion. Thus, the
 * parts of one pattern do not move as one flat picture:
 *
 * - the paper, the dots, the grid and the lines are one sheet each, which rolls
 *   from the top left to the bottom right;
 * - the waves are their rows, one row on each sheet, which each move in a small
 *   circle, one after the other, so that a swell passes down the page;
 * - the confetti, the stars, the hearts, the bubbles, the rain, the snow, the
 *   leaves, the petals and the frames are spread over sheets that fall,
 *   twinkle, rise or float at their own speeds;
 * - the sawtooth is its rows, every other row on one sheet, which run against
 *   each other.
 *
 * The stripes stay one sheet, which slides. Each sheet is drawn one time, as the
 * still textures are, in opaque black on the tile of its pattern (or a whole
 * number of them). Thus, the still and the moving pattern have the same marks.
 *
 * Each sheet is a masked layer the size of the board, which the compositor
 * blends again on each frame. Thus, a pattern has no more sheets than its
 * motion needs.
 */
export const SHEET_COUNTS = {
  paper: 1,
  dots: 1,
  grid: 1,
  lines: 1,
  waves: 8,
  confetti: 3,
  stars: 4,
  hearts: 3,
  bubbles: 3,
  rain: 3,
  snow: 3,
  leaves: 3,
  petals: 3,
  stripes: 1,
  frames: 3,
  sawtooth: 2,
} as const;

export type MovingTexture = keyof typeof SHEET_COUNTS;

/**
 * The sheets drawn here. The others are CSS gradients (board-background.css):
 * the stripes, the dots, the grid and the lines.
 */
export type DrawnSheetTexture = Exclude<
  MovingTexture,
  "stripes" | "dots" | "grid" | "lines"
>;

/**
 * The repeat of the gradient patterns, in px, as board-background.css draws
 * them. styles.test.ts holds the two equal, and holds the roll of each at one
 * repeat.
 */
export const DOT_STEP = 22;

export const GRID_STEP = 24;

export const LINE_STEP = 28;

/**
 * The lines, and the lines of the grid, are 2px, not 1px. On a screen mode that
 * macOS scales, a line of 1px flickers as it moves: it crosses the pixels of
 * the panel, and becomes thinner and thicker. A thicker line changes only at
 * its edges.
 */
export const LINE_WIDTH = 2;

export const WAVE_TILE = { width: 46, height: 36 } as const;

export const PAPER_TILE = NOISE.paper.size;

/**
 * Row `k` of eight rows of waves, on a tile eight rows high. A row is a crest
 * over each side edge and a trough under the middle, at the line between two
 * tiles of the still pattern. Row 0 is on the top and the bottom edge, each edge
 * with its own half.
 */
function waveSheet(k: number): string {
  const { width, height } = WAVE_TILE;
  const tall = height * SHEET_COUNTS.waves;
  const r = width / 4;
  const row = (y: number) =>
    `<path d='M${-r} ${y}A${r} ${r} 0 0 1 ${r} ${y}A${r} ${r} 0 0 0 ${3 * r} ${y}A${r} ${r} 0 0 1 ${5 * r} ${y}'/>`;
  const rows = k === 0 ? row(0) + row(tall) : row(height * k);
  return svg(
    width,
    tall,
    `<g fill='none' stroke='#000' stroke-width='1'>${rows}</g>`,
  );
}

/** Every `count`-th shape, from `k`, which mixes their sizes. */
function everyNth<T>(shapes: readonly T[], count: number, k: number): T[] {
  return shapes.filter((_, i) => i % count === k);
}

/**
 * The third `k` of the shapes by size, largest first, as they were placed.
 * Thus, the near sheet has the largest shapes, and moves fastest.
 */
function bySize<T>(shapes: readonly T[], count: number, k: number): T[] {
  const share = Math.ceil(shapes.length / count);
  return shapes.slice(share * k, share * (k + 1));
}

function sheets(
  texture: DrawnSheetTexture,
  draw: (k: number) => string,
): string[] {
  return Array.from({ length: SHEET_COUNTS[texture] }, (_, k) => draw(k));
}

/**
 * The shapes on each sheet, exported for their test, which holds each shape on
 * exactly one sheet.
 */
export const SHEET_SHAPES = {
  confetti: (k: number) => everyNth(CONFETTI, SHEET_COUNTS.confetti, k),
  stars: (k: number) => everyNth(SCATTERS.stars, SHEET_COUNTS.stars, k),
  hearts: (k: number) => bySize(SCATTERS.hearts, SHEET_COUNTS.hearts, k),
  bubbles: (k: number) => bySize(SCATTERS.bubbles, SHEET_COUNTS.bubbles, k),
  rain: (k: number) => bySize(SCATTERS.rain, SHEET_COUNTS.rain, k),
  snow: (k: number) => bySize(SCATTERS.snow, SHEET_COUNTS.snow, k),
  leaves: (k: number) => bySize(SCATTERS.leaves, SHEET_COUNTS.leaves, k),
  petals: (k: number) => bySize(SCATTERS.petals, SHEET_COUNTS.petals, k),
  frames: (k: number) => bySize(FRAMES, SHEET_COUNTS.frames, k),
};

/** Each sheet of each moving pattern as a mask, each a CSS `url(...)`. */
export function sheetTextures(): Record<DrawnSheetTexture, string[]> {
  return {
    paper: sheets("paper", () => noise(NOISE.paper)),
    waves: sheets("waves", waveSheet),
    confetti: sheets("confetti", (k) => drawConfetti(SHEET_SHAPES.confetti(k))),
    stars: sheets("stars", (k) => drawScatter("stars", SHEET_SHAPES.stars(k))),
    hearts: sheets("hearts", (k) =>
      drawScatter("hearts", SHEET_SHAPES.hearts(k)),
    ),
    bubbles: sheets("bubbles", (k) =>
      drawScatter("bubbles", SHEET_SHAPES.bubbles(k)),
    ),
    rain: sheets("rain", (k) => drawScatter("rain", SHEET_SHAPES.rain(k))),
    snow: sheets("snow", (k) => drawScatter("snow", SHEET_SHAPES.snow(k))),
    leaves: sheets("leaves", (k) =>
      drawScatter("leaves", SHEET_SHAPES.leaves(k)),
    ),
    petals: sheets("petals", (k) =>
      drawScatter("petals", SHEET_SHAPES.petals(k)),
    ),
    frames: sheets("frames", (k) => drawFrames(SHEET_SHAPES.frames(k))),
    sawtooth: sheets("sawtooth", (k) => drawSawtooth(k === 0 ? 0 : 1)),
  };
}

/** The `data:` address in a CSS `url("...")` that `dataUrl` made. */
function addressOf(cssUrl: string): string {
  return cssUrl.slice('url("'.length, -'")'.length);
}

/** The tile of each sheet of a pattern, in CSS px, as the painter draws it. */
export interface PaintedSheets {
  width: number;
  height: number;
  /** One `data:` address of an SVG for each sheet, in opaque black. */
  images: string[];
}

/** The repeat of the stripes across, and down: one stripe and its gap. */
const STRIPE_TILE = 32 * Math.SQRT2;

/**
 * Each sheet of each moving pattern, as an SVG on one tile, for the board
 * painter (boardPainter.ts). It draws the sheets that the stylesheet makes
 * with gradients too: the stripes, the dots, the grid and the lines, each as
 * one tile of the still pattern, at the place where the gradient draws it.
 */
export function paintedSheets(): Record<MovingTexture, PaintedSheets> {
  const drawn = sheetTextures();
  const tile = (size: number, sheets: string[]): PaintedSheets => ({
    width: size,
    height: size,
    images: sheets.map(addressOf),
  });
  const half = round(STRIPE_TILE / 2);
  const full = round(STRIPE_TILE);
  return {
    paper: tile(NOISE.paper.size, drawn.paper),
    dots: tile(DOT_STEP, [
      svg(DOT_STEP, DOT_STEP, `<circle cx='11' cy='11' r='1.5'/>`),
    ]),
    grid: tile(GRID_STEP, [
      svg(
        GRID_STEP,
        GRID_STEP,
        `<rect width='${GRID_STEP}' height='${LINE_WIDTH}'/><rect width='${LINE_WIDTH}' height='${GRID_STEP}'/>`,
      ),
    ]),
    lines: tile(LINE_STEP, [
      svg(
        LINE_STEP,
        LINE_STEP,
        `<rect y='${LINE_STEP - LINE_WIDTH}' width='${LINE_STEP}' height='${LINE_WIDTH}'/>`,
      ),
    ]),
    waves: {
      width: WAVE_TILE.width,
      height: WAVE_TILE.height * SHEET_COUNTS.waves,
      images: drawn.waves.map(addressOf),
    },
    confetti: tile(CONFETTI_TILE, drawn.confetti),
    stars: tile(SCATTER_TILE, drawn.stars),
    hearts: tile(SCATTER_TILE, drawn.hearts),
    bubbles: tile(SCATTER_TILE, drawn.bubbles),
    rain: tile(SCATTER_TILE, drawn.rain),
    snow: tile(SCATTER_TILE, drawn.snow),
    leaves: tile(LEAF_TILE, drawn.leaves),
    petals: tile(SCATTER_TILE, drawn.petals),
    frames: tile(FRAMES_TILE, drawn.frames),
    // The band where `x + y` is in the first half of a repeat, in the corner
    // at the top left and in the middle of the tile.
    stripes: tile(STRIPE_TILE, [
      svg(
        full,
        full,
        `<path d='M0 0H${half}L0 ${half}Z'/><path d='M${full} 0V${half}L${half} ${full}H0Z'/>`,
      ),
    ]),
    sawtooth: {
      width: SAWTOOTH_TILE.width,
      height: SAWTOOTH_TILE.height,
      images: drawn.sawtooth.map(addressOf),
    },
  };
}
