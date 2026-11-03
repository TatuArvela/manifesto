/**
 * The maple leaves of the board pattern (boardScatters.ts). Leaves that fall
 * are not all one leaf seen from above. Thus, there are four shapes, and a
 * leaf can be tilted:
 *
 * - a broad maple leaf with a short stem;
 * - a full leaf, five wide lobes with large teeth;
 * - the broad leaf with a long stem that curves away;
 * - the broad leaf as it tumbles, seen almost edge-on, with a long thin stem;
 * - a tilted leaf is squashed across or along itself, as a leaf that turns
 *   in the air is seen at an angle.
 *
 * Each shape is one path in the `<defs>` of the mask, which each leaf uses at
 * its place, turn, size and tilt. Thus, the mask stays small.
 */

type Point = readonly [x: number, y: number];

const round = (n: number) => Number(n.toFixed(3));

/** A closed path through `points`. */
function outline(points: readonly Point[]): string {
  return `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join(" L")}Z`;
}

/** Twice the signed area of `points`. Its sign is the way that it goes round. */
function area(points: readonly Point[]): number {
  return points.reduce((sum, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length] ?? [0, 0];
    return sum + x * ny - nx * y;
  }, 0);
}

/**
 * The right half of the broad leaf, from the tip of its top lobe down to its
 * stem: the top lobe, a side lobe that points up and out, and a small lobe
 * under it.
 */
const BROAD_HALF: readonly Point[] = [
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
];

/** A half and the same half the other way round, from the top tip. */
function bothHalves(half: readonly Point[], stem: readonly Point[]): Point[] {
  const right = [...half, ...stem];
  return [
    [0, -10],
    ...right,
    ...[...right].reverse().map(([x, y]): Point => [-x, y]),
  ];
}

const BROAD = bothHalves(BROAD_HALF, [
  [0.7, 3.2],
  [0.7, 7.5],
]);

/** A point at `r` from the centre, `degrees` clockwise from straight up. */
function polar(r: number, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

/** The five lobes of the full leaf: their direction and length. */
const LOBES: readonly (readonly [degrees: number, reach: number])[] = [
  [-115, 6.4],
  [-58, 9.2],
  [0, 10.2],
  [58, 9.2],
  [115, 6.4],
];

/**
 * The full leaf: five wide lobes with a large tooth on each side of each, and
 * a shallow notch between one lobe and the next. Thus, it is fuller than the
 * broad leaf, and still a maple leaf. Narrow, deep lobes, the versions before
 * it, looked like a different plant, not like a maple.
 */
const FULL: Point[] = [
  ...LOBES.flatMap(([degrees, reach], i): Point[] => {
    const lobe: Point[] = [
      polar(reach * 0.55, degrees - 30),
      polar(reach * 0.82, degrees - 24),
      polar(reach * 0.72, degrees - 13),
      polar(reach, degrees),
      polar(reach * 0.72, degrees + 13),
      polar(reach * 0.82, degrees + 24),
      polar(reach * 0.55, degrees + 30),
    ];
    const next = LOBES[i + 1];
    return next ? [...lobe, polar(4.6, (degrees + next[0]) / 2)] : lobe;
  }),
  [0.55, 4.2],
  [0.55, 8],
  [-0.55, 8],
  [-0.55, 4.2],
];

/**
 * A stem as a band along a quadratic curve from `from` to `to`, `start` wide
 * at its base and `end` wide at its tip.
 */
function curvedStem(
  from: Point,
  bend: Point,
  to: Point,
  start: number,
  end: number,
): Point[] {
  const at = (t: number): Point => [
    (1 - t) ** 2 * from[0] + 2 * (1 - t) * t * bend[0] + t * t * to[0],
    (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * bend[1] + t * t * to[1],
  ];
  const left: Point[] = [];
  const right: Point[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = at(t);
    const [ax, ay] = at(Math.max(0, t - 0.01));
    const [bx, by] = at(Math.min(1, t + 0.01));
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const half = (start + (end - start) * t) / 2;
    const nx = (-(by - ay) / length) * half;
    const ny = ((bx - ax) / length) * half;
    left.push([x + nx, y + ny]);
    right.push([x - nx, y - ny]);
  }
  return [...left, ...right.reverse()];
}

/**
 * `stem` going round the same way as `leaf`. Thus, the nonzero fill joins
 * them where they meet, and makes no hole.
 */
function sameWay(stem: Point[], leaf: readonly Point[]): Point[] {
  return Math.sign(area(stem)) === Math.sign(area(leaf))
    ? stem
    : stem.reverse();
}

/** The broad leaf with no stem, for the two shapes with a long one. */
const BARE_LEAF = bothHalves(BROAD_HALF, [[0.7, 3.2]]);

/** The broad leaf with a long stem that curves away to one side. */
const CURLED_STEM = sameWay(
  curvedStem([0, 2.8], [0.2, 8], [3.2, 10.6], 1, 0.6),
  BARE_LEAF,
);

/**
 * The broad leaf as it tumbles, seen almost edge-on: turned so that its stem
 * points right, squashed to 60% of its height above its midrib and to a third
 * below it (the leaf curls under), with its lobes leaning back. A long thin
 * stem curves up and away from its base, as a whip.
 */
function tumbled([x, y]: Point): Point {
  const up = -x;
  const squashed = up < 0 ? up * 0.6 : up * 0.33;
  return [y - 0.35 * squashed, squashed];
}
const TUMBLING_LEAF = BARE_LEAF.map(tumbled);
const TUMBLING_STEM = (() => {
  const [bx, by] = tumbled([0, 3]);
  return sameWay(
    curvedStem([bx, by], [bx + 6, by - 0.5], [bx + 10.5, by - 7.5], 0.76, 0.24),
    TUMBLING_LEAF,
  );
})();

/**
 * The parts of each shape, in the order of `LeafLook.shape`, each moved so
 * that the middle of its bounding box is at the centre. Thus, a shape with a
 * long stem to one side does not reach far past its leaf on that side only,
 * and its leaf is not drawn smaller than the others.
 */
const SHAPES: readonly (readonly Point[])[][] = [
  [BROAD],
  [FULL],
  [BARE_LEAF, CURLED_STEM],
  [TUMBLING_LEAF, TUMBLING_STEM],
].map((parts) => {
  const all = parts.flat();
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return parts.map((part) => part.map(([x, y]): Point => [x - cx, y - cy]));
});

/** How far each shape reaches from its centre, which a leaf is scaled by. */
const REACHES = SHAPES.map((parts) =>
  Math.max(...parts.flat().map(([x, y]) => Math.hypot(x, y))),
);

/** The paths of the shapes, for the `<defs>` of the mask. */
export const LEAF_DEFS = `<defs>${SHAPES.map(
  (parts, i) => `<path id='m${i}' d='${parts.map(outline).join("")}'/>`,
).join("")}</defs>`;

/**
 * The look of one leaf: its shape, and how far it is squashed across itself
 * and along itself. 1 is not squashed.
 */
export interface LeafLook {
  shape: 0 | 1 | 2 | 3;
  across: number;
  along: number;
}

/** The narrowest that a tilted leaf is squashed to. */
export const LEAF_NARROWEST = 0.4;

/**
 * A look for each of `count` leaves. Of the shapes, the broad leaf is the most
 * frequent. A tumbling leaf is already seen edge-on. Of the others, about four
 * in ten are flat, seen from above, and each other one is squashed across or
 * along itself, to between 40% and 90%.
 */
export function leafLooks(count: number, random: () => number): LeafLook[] {
  return Array.from({ length: count }, () => {
    const pick = random();
    const shape = pick < 0.35 ? 0 : pick < 0.6 ? 1 : pick < 0.8 ? 2 : 3;
    if (shape === 3 || random() < 0.4) return { shape, across: 1, along: 1 };
    const squash = round(LEAF_NARROWEST + 0.5 * random());
    return random() < 0.5
      ? { shape, across: squash, along: 1 }
      : { shape, across: 1, along: squash };
  });
}

/** One leaf, `reach` px from its centre, at its place, turn and look. */
export function drawLeaf(
  look: LeafLook,
  reach: number,
  turn: number,
  x: number,
  y: number,
): string {
  const scale = reach / (REACHES[look.shape] ?? 1);
  return `<use href='#m${look.shape}' transform='translate(${x} ${y}) rotate(${turn}) scale(${round(scale * look.across)} ${round(scale * look.along)})'/>`;
}
