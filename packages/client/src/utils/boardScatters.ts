import { across, dataUrl, round, seeded } from "./boardSvg.ts";

/**
 * The scattered patterns of the board: bubbles, stars, hearts, rain, snow,
 * maple leaves and sakura petals. Each is a set of shapes of many sizes, each
 * clear of the others, spread over a tile with no visible grid.
 */

/**
 * The tile the bubbles, stars, hearts, rain, snow and petals are scattered
 * on, in px: wide for the same reason as the confetti's.
 */
export const SCATTER_TILE = 360;

/**
 * The tile of the maple leaves, in px: wider, because a leaf is large. A maple
 * leaf smaller than about 20px shows as a blot, not as its lobes.
 */
export const LEAF_TILE = 480;

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
  /** The tile, in px, if not `SCATTER_TILE`. */
  tile?: number;
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
  const tile = kind.tile ?? SCATTER_TILE;
  const spread = kind.largest - kind.smallest;
  const radii = Array.from(
    { length: kind.count },
    () => kind.smallest + spread * random() ** 1.6,
  ).sort((a, b) => b - a);
  const placed: Scattered[] = [];
  for (const r of radii) {
    let best = { x: 0, y: 0, clear: Number.NEGATIVE_INFINITY };
    for (let tries = 0; tries < 80; tries++) {
      const x = random() * tile;
      const y = random() * tile;
      let clear = Number.POSITIVE_INFINITY;
      for (const other of placed) {
        const d = Math.hypot(
          across(x, other.x, tile),
          across(y, other.y, tile),
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
  // A drop is a streak, as long as its circle is wide. Each falls on the same
  // slant (`RAIN_TURN`). Thus, none is turned on its own.
  rain: scatter({
    seed: 20261103,
    count: 150,
    smallest: 3,
    largest: 16,
    turn: 0,
  }),
  // A flake has six arms. Thus, a turn of 30 degrees either way is any turn.
  snow: scatter({
    seed: 20261104,
    count: 90,
    smallest: 3,
    largest: 9,
    turn: 30,
  }),
  leaves: scatter({
    seed: 20261105,
    count: 70,
    smallest: 10,
    largest: 21,
    turn: 180,
    tile: LEAF_TILE,
  }),
  petals: scatter({
    seed: 20261106,
    count: 110,
    smallest: 4,
    largest: 8,
    turn: 180,
  }),
} as const satisfies Record<string, readonly Scattered[]>;

/** The tile of each scatter, in px. */
export function scatterTile(name: keyof typeof SCATTERS): number {
  return name === "leaves" ? LEAF_TILE : SCATTER_TILE;
}

/** A five-pointed star reaching 1 from its centre, its inner points 0.42. */
const STAR = `M${Array.from({ length: 10 }, (_, i) => {
  const reach = i % 2 === 0 ? 1 : 0.42;
  const angle = (i * Math.PI) / 5 - Math.PI / 2;
  return `${round(reach * Math.cos(angle))} ${round(reach * Math.sin(angle))}`;
}).join(" L")}Z`;

/** A heart about nineteen units wide, reaching about 9 from its centre. */
const HEART = "M0 7 C-9.33 0.78 -8.56 -7 0 -2.72 C8.56 -7 9.33 0.78 0 7Z";

const HEART_REACH = 9;

/**
 * Where the rain falls in one loop, in px: one tile across and four down.
 * Thus, it falls on a slant of 14 degrees, as in wind, and the loop ends on
 * whole tiles. A drop on a slant that does not repeat on the tile jumps each
 * time that the loop starts.
 */
export const RAIN_FALL = { x: -SCATTER_TILE, y: 4 * SCATTER_TILE } as const;

/** The turn of each drop, in degrees, along the way that it falls. */
const RAIN_TURN = round(
  (Math.atan2(-RAIN_FALL.x, RAIN_FALL.y) * 180) / Math.PI,
);

/**
 * A bar from one point to another, `width` wide, as a closed path. Each bar
 * goes around in the same direction. Thus, where bars cross, the nonzero fill
 * joins them, and makes no hole.
 */
function bar(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
): string {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const nx = (-(y2 - y1) / length) * (width / 2);
  const ny = ((x2 - x1) / length) * (width / 2);
  const points = [
    [x1 + nx, y1 + ny],
    [x2 + nx, y2 + ny],
    [x2 - nx, y2 - ny],
    [x1 - nx, y1 - ny],
  ];
  return `M${points.map(([x = 0, y = 0]) => `${round(x)} ${round(y)}`).join(" L")}Z`;
}

/**
 * A snowflake reaching 1 from its centre: six arms, each with two branches
 * past its middle that point out.
 */
const SNOWFLAKE = Array.from({ length: 6 }, (_, i) => {
  const angle = (i * Math.PI) / 3 - Math.PI / 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const fork = { x: 0.55 * dx, y: 0.55 * dy };
  const branches = [-1, 1].map((side) => {
    const turn = angle + (side * Math.PI) / 4;
    return bar(
      fork.x,
      fork.y,
      fork.x + 0.36 * Math.cos(turn),
      fork.y + 0.36 * Math.sin(turn),
      0.14,
    );
  });
  return bar(0, 0, dx, dy, 0.17) + branches.join("");
}).join("");

/**
 * The right half of a maple leaf, from the tip of its top lobe down to its
 * stem: the top lobe, a side lobe that points up and out, and a small lobe
 * under it. The left half is the same, the other way round.
 */
const MAPLE_HALF: readonly (readonly [number, number])[] = [
  [1.3, -7.4],
  [3, -8.2],
  [2.4, -4],
  [4.6, -4.6],
  [5, -3.6],
  [9.2, -5],
  [7.6, -1.6],
  [9, -0.4],
  [4.2, 1.2],
  [5.6, 3.6],
  [1.6, 2.8],
  [0.7, 3.2],
  [0.7, 7.5],
];

/** A maple leaf about twenty units wide, reaching about 10.5 from its centre. */
const MAPLE_LEAF = `M0 -10 L${[
  ...MAPLE_HALF,
  ...[...MAPLE_HALF].reverse().map(([x, y]) => [-x, y] as const),
]
  .map(([x, y]) => `${x} ${y}`)
  .join(" L")}Z`;
const MAPLE_REACH = 10.5;

/**
 * A sakura petal reaching 1 from its centre: narrow at its base, widest past
 * its middle, and round at its top, with a small notch in it.
 */
const PETAL =
  "M0 1C0.45 0.75 0.78 0.05 0.62 -0.55C0.55 -0.85 0.32 -1 0.16 -0.97L0 -0.78L-0.16 -0.97C-0.32 -1 -0.55 -0.85 -0.62 -0.55C-0.78 0.05 -0.45 0.75 0 1Z";

/** Where a shape is drawn: its place, and again past each edge it crosses. */
function placesOf(
  { x, y, r }: Scattered,
  tile = SCATTER_TILE,
): [number, number][] {
  const xs = [x];
  const ys = [y];
  if (x < r) xs.push(x + tile);
  if (x > tile - r) xs.push(x - tile);
  if (y < r) ys.push(y + tile);
  if (y > tile - r) ys.push(y - tile);
  return xs.flatMap((px) => ys.map((py): [number, number] => [px, py]));
}

function scattered(
  shapes: readonly Scattered[],
  draw: (shape: Scattered, x: number, y: number) => string,
  defs = "",
  tile = SCATTER_TILE,
): string {
  const drawn = shapes
    .flatMap((shape) =>
      placesOf(shape, tile).map(([x, y]) => draw(shape, round(x), round(y))),
    )
    .join("");
  return dataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>${defs}${drawn}</svg>`,
  );
}

/**
 * A path drawn one time in the defs, and used at each shape's place, turn and
 * size. For a long path (the snowflake), each copy of it would make the mask
 * many times larger.
 */
function usedPath(d: string): {
  defs: string;
  draw: (shape: Scattered, x: number, y: number) => string;
} {
  return {
    defs: `<defs><path id='s' d='${d}'/></defs>`,
    draw: ({ r, turn }, x, y) =>
      `<use href='#s' transform='translate(${x} ${y}) rotate(${turn}) scale(${r})'/>`,
  };
}

const FLAKE = usedPath(SNOWFLAKE);

/** A path drawn at a shape's place, turn and size. */
function placedPath(d: string, reach: number) {
  return ({ r, turn }: Scattered, x: number, y: number) =>
    `<path transform='translate(${x} ${y}) rotate(${turn}) scale(${round(r / reach)})' d='${d}'/>`;
}

/**
 * A drop of rain: a streak as long as its circle is wide, with a round head at
 * the bottom and a thin tail at the top, turned along the way that it falls. A
 * longer drop is nearer. Thus, it is also wider. Its head is 1.5px wide or
 * more: a thinner mark flickers as it moves on a screen mode that macOS
 * scales. Only the tail is thinner, and it fades as it should.
 */
function drop({ r }: Scattered, x: number, y: number): string {
  const half = round((1.5 + 0.08 * r) / 2);
  // The curve of the head ends inside the circle of the drop. Thus, the copy
  // of a drop past an edge of the tile has all of it.
  const neck = round(r - 1.3 * half);
  const curl = round(r);
  return `<path transform='translate(${x} ${y}) rotate(${RAIN_TURN})' d='M-0.2 ${-r}L0.2 ${-r}L${half} ${neck}C${half} ${curl} ${-half} ${curl} ${-half} ${neck}Z'/>`;
}

function circle({ r }: Scattered, x: number, y: number): string {
  return `<circle cx='${x}' cy='${y}' r='${r}'/>`;
}

/** How each scatter draws its shapes, and the paths that they use. */
const DRAWS: Record<
  keyof typeof SCATTERS,
  {
    draw: (shape: Scattered, x: number, y: number) => string;
    defs?: string;
  }
> = {
  bubbles: { draw: circle },
  stars: { draw: placedPath(STAR, 1) },
  hearts: { draw: placedPath(HEART, HEART_REACH) },
  rain: { draw: drop },
  snow: FLAKE,
  leaves: { draw: placedPath(MAPLE_LEAF, MAPLE_REACH) },
  petals: { draw: placedPath(PETAL, 1) },
};

/**
 * The mask of the scatter `name`, as a CSS `url(...)`: all its shapes, or
 * only `shapes` (the shapes of one sheet).
 */
export function drawScatter(
  name: keyof typeof SCATTERS,
  shapes: readonly Scattered[] = SCATTERS[name],
): string {
  const { draw, defs = "" } = DRAWS[name];
  return scattered(shapes, draw, defs, scatterTile(name));
}
