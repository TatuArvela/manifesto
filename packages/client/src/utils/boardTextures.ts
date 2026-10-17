/**
 * The board textures that are pictures rather than gradients: the paper
 * grain, which is SVG turbulence, and the stars, hearts, confetti and
 * sawtooth. Every texture is a mask over one layer behind the board, which
 * takes the pattern's colour as its background and the pattern's opacity as
 * its own (`.board-frame::before` in preferences.css). So these are drawn
 * once, in opaque black, and handed to the stylesheet as they are: only their
 * shape is read, and neither the colour nor the opacity redraws them.
 */

export type PictureTexture =
  | "paper"
  | "stars"
  | "hearts"
  | "confetti"
  | "sawtooth";

/**
 * The colourful pattern colours, as the note colours' vivid shades: drawn
 * translucent like a custom colour, so one shade reads on light and dark.
 */
export const INK_COLORS = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
} as const;

export type InkColor = keyof typeof INK_COLORS;

/** Every pattern colour but the theme's own. */
export type PickedInkChoice = "white" | "black" | InkColor | "custom";

/**
 * The pattern's opacity, in percent: one value for every texture, gradient or
 * picture, and every colour, so the slider in Settings means the same thing
 * whichever is chosen.
 */
export const MIN_TEXTURE_OPACITY = 0;
export const MAX_TEXTURE_OPACITY = 100;
export const DEFAULT_TEXTURE_OPACITY = 10;

/**
 * The colour a picked pattern colour draws in, as `#rrggbb`. `customHex` is
 * a validated `#rrggbb`.
 */
export function inkHex(choice: PickedInkChoice, customHex: string): string {
  if (choice === "white") return "#ffffff";
  if (choice === "black") return "#000000";
  return choice === "custom" ? customHex : INK_COLORS[choice];
}

interface Noise {
  size: number;
  frequency: number;
  octaves: number;
}

const NOISE: Record<"paper", Noise> = {
  paper: { size: 160, frequency: 0.8, octaves: 3 },
};

/**
 * The alpha row of the grain's colour matrix: noise alpha times the slope,
 * plus the offset, which cuts the faintest grain away. The noise sits about
 * the middle, so the grain runs from nothing to fully drawn and is half
 * drawn on average: a mask of it, unlike one of shapes, has every degree.
 */
const GRAIN_SLOPE = 2;
const GRAIN_OFFSET = -0.5;

const STARS = [
  "M15.0 9.1 L16.2 13.7 L20.9 14.8 L16.8 17.4 L17.3 22.2 L13.6 19.1 L9.1 21.0 L10.9 16.5 L7.7 12.9 L12.5 13.2Z",
  "M42.9 35.6 L44.8 38.1 L47.8 37.6 L46.0 40.1 L47.4 42.9 L44.5 42.0 L42.3 44.2 L42.3 41.1 L39.5 39.7 L42.4 38.7Z",
  "M50.9 7.7 L50.9 9.4 L52.5 10.1 L50.9 10.7 L50.7 12.4 L49.6 11.1 L47.9 11.4 L48.9 10.0 L48.0 8.5 L49.7 8.9Z",
  "M17.7 45.0 L18.7 46.8 L20.7 46.8 L19.3 48.3 L20.0 50.2 L18.1 49.3 L16.5 50.6 L16.8 48.5 L15.1 47.4 L17.1 47.0Z",
];

/**
 * One heart, about nineteen units wide at scale 1, placed five times at its
 * own size and tilt. Laid out apart from the stars, so the two patterns do
 * not share an arrangement, and each far enough inside the 60-unit tile that
 * none is cut at an edge.
 */
const HEART = "M0 7 C-9.33 0.78 -8.56 -7 0 -2.72 C8.56 -7 9.33 0.78 0 7Z";
const HEARTS = [
  { x: 42, y: 15, turn: 10, scale: 0.8 },
  { x: 14, y: 28, turn: -14, scale: 0.55 },
  { x: 33, y: 47, turn: 6, scale: 0.7 },
  { x: 52, y: 38, turn: -8, scale: 0.4 },
  { x: 10, y: 51, turn: 12, scale: 0.35 },
];

/**
 * The stars and hearts are laid out on a 60-unit tile and drawn half as large
 * again, on a 90px one (`--board-texture-stars-size` in preferences.css).
 */
const SHAPE_SCALE = 1.5;
const SHAPE_TILE = 60 * SHAPE_SCALE;

const round = (n: number) => Number(n.toFixed(3));

/** Confetti's tile, in px: wide, so the eye does not find it repeating. */
export const CONFETTI_TILE = 320;

interface ConfettiPiece {
  x: number;
  y: number;
  /** A strip of paper turned to `turn` degrees, or a round dot. */
  strip: boolean;
  turn: number;
}

/**
 * The sawtooth is the logo itself, in rows turned 45° up from the level: its
 * 1080-unit square laid edge to edge, so its notches make teeth along both
 * sides of each row, and between the rows a line about the logo's stroke
 * wide with the notches as barbs on it, like barbed wire. The logo repeats
 * every 540 units along a row.
 *
 * A turned pattern repeats on a level tile only when going across it and
 * down it both land on whole teeth and whole rows, which at 45° takes rows
 * a whole fraction of a tooth apart. Five halves of one makes the line 270
 * units wide, against the 253.622 of the logo's straight columns, and
 * repeats every 5 teeth and 2 rows: a tile 2700√2 units square, drawn at
 * 81px a logo as 286px. Each row is one path, so no seam shows within it.
 */
const SAWTOOTH_TURN = -45;
const SAWTOOTH_TOOTH = 540;
const SAWTOOTH_ROW = (SAWTOOTH_TOOTH * 5) / 2;
const SAWTOOTH_UNITS = {
  width: 5 * SAWTOOTH_TOOTH * Math.SQRT2,
  height: 5 * SAWTOOTH_TOOTH * Math.SQRT2,
} as const;
export const SAWTOOTH_TILE = { width: 286, height: 286 } as const;

/** One tooth of the logo along a row's top edge, then back along its foot. */
const TOOTH_TOP = "l286.378-286.378h253.622v286.378";
const TOOTH_FOOT = "h-253.622v-286.378l-286.378 286.378";

/** A small seeded generator, so the confetti falls the same way every load. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The shortest way from `b` to `a` along one axis of the tile, signed. */
function across(a: number, b: number): number {
  return (
    ((((a - b + CONFETTI_TILE / 2) % CONFETTI_TILE) + CONFETTI_TILE) %
      CONFETTI_TILE) -
    CONFETTI_TILE / 2
  );
}

/**
 * Where the confetti lies, measured around the tile's edges throughout, so a
 * seam is as evenly covered as the middle and the tile does not show. Each
 * piece first goes in the best of a growing number of random spots, the one
 * farthest from those already down, which spreads it with no grid to see.
 * That still leaves holes, so the pieces then push off their neighbours for
 * a few rounds: enough to close them (the largest falls from 43px to 31px,
 * against 27px for a perfect lattice), not so many that a lattice appears.
 */
function scatterConfetti(count: number): ConfettiPiece[] {
  const random = seeded(20261016);
  const spots: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    let best = { x: 0, y: 0, room: -1 };
    for (let tries = 0; tries < 3 * i + 1; tries++) {
      const x = random() * CONFETTI_TILE;
      const y = random() * CONFETTI_TILE;
      let room = Number.POSITIVE_INFINITY;
      for (const other of spots) {
        room = Math.min(
          room,
          Math.hypot(across(x, other.x), across(y, other.y)),
        );
      }
      if (room > best.room) best = { x, y, room };
    }
    spots.push({ x: best.x, y: best.y });
  }

  const reach = 60;
  for (let pass = 0; pass < 40; pass++) {
    const pushed = spots.map(({ x, y }, i) => {
      let dx = 0;
      let dy = 0;
      for (const [j, other] of spots.entries()) {
        if (i === j) continue;
        const ox = across(x, other.x);
        const oy = across(y, other.y);
        const d = Math.hypot(ox, oy);
        if (d >= reach) continue;
        const weight = (reach - d) / reach / Math.max(d, 1);
        dx += ox * weight;
        dy += oy * weight;
      }
      const wrap = (v: number) =>
        ((v % CONFETTI_TILE) + CONFETTI_TILE) % CONFETTI_TILE;
      return { x: wrap(x + dx * 8), y: wrap(y + dy * 8) };
    });
    spots.splice(0, spots.length, ...pushed);
  }

  return spots.map(({ x, y }) => ({
    x: round(x),
    y: round(y),
    strip: random() < 0.7,
    turn: Math.round(random() * 180),
  }));
}

/** Exported for its test, which holds the scatter free of holes. */
export const CONFETTI: readonly ConfettiPiece[] = scatterConfetti(52);

/** A piece as SVG, and again past each edge it comes near, so it is never cut. */
function confettiPiece({ x, y, strip, turn }: ConfettiPiece): string {
  const reach = 6;
  const xs = [x];
  const ys = [y];
  if (x < reach) xs.push(x + CONFETTI_TILE);
  if (x > CONFETTI_TILE - reach) xs.push(x - CONFETTI_TILE);
  if (y < reach) ys.push(y + CONFETTI_TILE);
  if (y > CONFETTI_TILE - reach) ys.push(y - CONFETTI_TILE);
  return xs
    .flatMap((px) =>
      ys.map((py) =>
        strip
          ? `<rect x='-1.25' y='-3.5' width='2.5' height='7' rx='0.6' transform='translate(${round(px)} ${round(py)}) rotate(${turn})'/>`
          : `<circle cx='${round(px)}' cy='${round(py)}' r='2'/>`,
      ),
    )
    .join("");
}

function confetti(): string {
  return dataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${CONFETTI_TILE}' height='${CONFETTI_TILE}'>${CONFETTI.map(confettiPiece).join("")}</svg>`,
  );
}

/**
 * Every row that crosses the tile, as one long row drawn once and placed
 * again at each row's offset, all turned together. The rows' reach is the
 * tile's corners measured along and across them, with a tooth and a row to
 * spare at each end, and starts on a whole tooth so the rows stay in step.
 */
function sawtooth(): string {
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
    rows.push(`<use href='#r' y='${round(n * SAWTOOTH_ROW)}'/>`);
  }
  return dataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${SAWTOOTH_TILE.width}' height='${SAWTOOTH_TILE.height}' viewBox='0 0 ${width} ${round(height)}' preserveAspectRatio='none'><defs><path id='r' d='${row}'/></defs><g transform='rotate(${SAWTOOTH_TURN})'>${rows.join("")}</g></svg>`,
  );
}

function dataUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function noise(texture: Noise): string {
  const matrix = `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${GRAIN_SLOPE} ${GRAIN_OFFSET}`;
  return dataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${texture.size}' height='${texture.size}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${texture.frequency}' numOctaves='${texture.octaves}' stitchTiles='stitch'/><feColorMatrix values='${matrix}'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
  );
}

function shapes(paths: string): string {
  return dataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${SHAPE_TILE}' height='${SHAPE_TILE}'><g transform='scale(${SHAPE_SCALE})'>${paths}</g></svg>`,
  );
}

/** Every picture texture as a mask, each a CSS `url(...)`. */
export function pictureTextures(): Record<PictureTexture, string> {
  return {
    paper: noise(NOISE.paper),
    stars: shapes(STARS.map((d) => `<path d='${d}'/>`).join("")),
    hearts: shapes(
      HEARTS.map(
        ({ x, y, turn, scale }) =>
          `<path transform='translate(${x} ${y}) rotate(${turn}) scale(${scale})' d='${HEART}'/>`,
      ).join(""),
    ),
    confetti: confetti(),
    sawtooth: sawtooth(),
  };
}
