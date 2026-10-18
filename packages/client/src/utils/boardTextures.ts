/**
 * The board textures that are pictures rather than gradients: the paper
 * grain, which is SVG turbulence, and the stars, hearts, confetti, bubbles
 * and sawtooth. Every texture is a mask over one layer behind the board, which
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
  | "bubbles"
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

/** The shortest way from `b` to `a` along one axis of a tile, signed. */
function across(a: number, b: number, tile = CONFETTI_TILE): number {
  return ((((a - b + tile / 2) % tile) + tile) % tile) - tile / 2;
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
 * The tile the bubbles, stars and hearts are scattered on, in px: wide for
 * the same reason as the confetti's.
 */
export const SCATTER_TILE = 360;

/** A shape of a scatter: its centre, the radius it reaches, its turn. */
export interface Scattered {
  x: number;
  y: number;
  r: number;
  turn: number;
}

interface ScatterKind {
  seed: number;
  count: number;
  /** The radii the shapes are drawn between, in px. */
  smallest: number;
  largest: number;
  /** The most a shape is turned either way, in degrees. */
  turn: number;
}

/** The least clear space between two shapes, in px. */
const SCATTER_GAP = 4;

/**
 * Shapes of every size between `smallest` and `largest`, more of them small
 * than large. They go in largest first, each in the best of many random
 * spots: the one that leaves it the most clear space to the shapes already
 * down, measured around the tile's edges, so the small ones settle into the
 * gaps between the large and no row or column lines up from one tile to the
 * next. A shape may cross an edge, since it is drawn on both sides; a scatter
 * kept inside its tile left a band along each seam with no large shape in
 * it, and on a tile of a handful of shapes the tile itself showed as a grid.
 */
function scatter(kind: ScatterKind): Scattered[] {
  const random = seeded(kind.seed);
  const spread = kind.largest - kind.smallest;
  const radii = Array.from(
    { length: kind.count },
    () => kind.smallest + spread * random() ** 1.6,
  ).sort((a, b) => b - a);
  const placed: Scattered[] = [];
  for (const r of radii) {
    let best = { x: 0, y: 0, clear: Number.NEGATIVE_INFINITY };
    for (let tries = 0; tries < 80; tries++) {
      const x = random() * SCATTER_TILE;
      const y = random() * SCATTER_TILE;
      let clear = Number.POSITIVE_INFINITY;
      for (const other of placed) {
        const d = Math.hypot(
          across(x, other.x, SCATTER_TILE),
          across(y, other.y, SCATTER_TILE),
        );
        clear = Math.min(clear, d - other.r - r);
      }
      if (clear > best.clear) best = { x, y, clear };
    }
    if (best.clear < SCATTER_GAP) continue;
    placed.push({
      x: round(best.x),
      y: round(best.y),
      r: round(r),
      turn: Math.round((random() * 2 - 1) * kind.turn),
    });
  }
  return placed;
}

/** Exported for their test, which holds each apart and its tile full. */
export const SCATTERS = {
  bubbles: scatter({
    seed: 20261019,
    count: 100,
    smallest: 4,
    largest: 14,
    turn: 0,
  }),
  stars: scatter({
    seed: 20261020,
    count: 70,
    smallest: 3,
    largest: 11,
    turn: 36,
  }),
  // Of the seeds tried, the one leaving the narrowest bare patch: a heart
  // fills less of its circle than a bubble, so a gap shows sooner.
  hearts: scatter({
    seed: 20261061,
    count: 90,
    smallest: 5,
    largest: 12,
    turn: 15,
  }),
} as const satisfies Record<string, readonly Scattered[]>;

/** A five-pointed star reaching 1 from its centre, its inner points 0.42. */
const STAR = `M${Array.from({ length: 10 }, (_, i) => {
  const reach = i % 2 === 0 ? 1 : 0.42;
  const angle = (i * Math.PI) / 5 - Math.PI / 2;
  return `${round(reach * Math.cos(angle))} ${round(reach * Math.sin(angle))}`;
}).join(" L")}Z`;

/** A heart about nineteen units wide, reaching about 9 from its centre. */
const HEART = "M0 7 C-9.33 0.78 -8.56 -7 0 -2.72 C8.56 -7 9.33 0.78 0 7Z";
const HEART_REACH = 9;

/** Where a shape is drawn: its place, and again past each edge it crosses. */
function placesOf({ x, y, r }: Scattered): [number, number][] {
  const xs = [x];
  const ys = [y];
  if (x < r) xs.push(x + SCATTER_TILE);
  if (x > SCATTER_TILE - r) xs.push(x - SCATTER_TILE);
  if (y < r) ys.push(y + SCATTER_TILE);
  if (y > SCATTER_TILE - r) ys.push(y - SCATTER_TILE);
  return xs.flatMap((px) => ys.map((py): [number, number] => [px, py]));
}

function scattered(
  shapes: readonly Scattered[],
  draw: (shape: Scattered, x: number, y: number) => string,
): string {
  const drawn = shapes
    .flatMap((shape) =>
      placesOf(shape).map(([x, y]) => draw(shape, round(x), round(y))),
    )
    .join("");
  return dataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${SCATTER_TILE}' height='${SCATTER_TILE}'>${drawn}</svg>`,
  );
}

/** A path drawn at a shape's place, turn and size. */
function placedPath(d: string, reach: number) {
  return ({ r, turn }: Scattered, x: number, y: number) =>
    `<path transform='translate(${x} ${y}) rotate(${turn}) scale(${round(r / reach)})' d='${d}'/>`;
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

/** Every picture texture as a mask, each a CSS `url(...)`. */
export function pictureTextures(): Record<PictureTexture, string> {
  return {
    paper: noise(NOISE.paper),
    stars: scattered(SCATTERS.stars, placedPath(STAR, 1)),
    hearts: scattered(SCATTERS.hearts, placedPath(HEART, HEART_REACH)),
    confetti: confetti(),
    bubbles: scattered(
      SCATTERS.bubbles,
      ({ r }, x, y) => `<circle cx='${x}' cy='${y}' r='${r}'/>`,
    ),
    sawtooth: sawtooth(),
  };
}
