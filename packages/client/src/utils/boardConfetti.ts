import { across, dataUrl, round, seeded } from "./boardSvg.ts";

/**
 * The confetti of the board pattern: strips of paper and round dots, spread
 * evenly over a tile with no visible grid.
 */

/**
 * The tile of the confetti, in px: wide, so that the eye does not see it
 * repeat.
 */
export const CONFETTI_TILE = 320;

export interface ConfettiPiece {
  x: number;
  y: number;
  /** A strip of paper turned to `turn` degrees, or a round dot. */
  strip: boolean;
  turn: number;
}

/**
 * Where the confetti is, measured around the edges of the tile in all places.
 * Thus, a seam is as evenly covered as the middle, and the tile does not show.
 * Each piece first goes in the best of an increasing number of random
 * positions, the position farthest from the pieces already placed, which
 * spreads it with no visible grid. That still leaves holes. Thus, the pieces
 * then push away from their neighbors for a few rounds: sufficient to close
 * them (the largest goes from 43px to 31px, against 27px for a perfect
 * lattice), but not so many that a lattice shows.
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
          Math.hypot(
            across(x, other.x, CONFETTI_TILE),
            across(y, other.y, CONFETTI_TILE),
          ),
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
        const ox = across(x, other.x, CONFETTI_TILE);
        const oy = across(y, other.y, CONFETTI_TILE);
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

/** Exported for its test, which makes sure that the scatter has no holes. */
export const CONFETTI: readonly ConfettiPiece[] = scatterConfetti(52);

/**
 * A piece as SVG, and again past each edge that it comes near. Thus, it is
 * never cut.
 */
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

export function drawConfetti(
  pieces: readonly ConfettiPiece[] = CONFETTI,
): string {
  return dataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${CONFETTI_TILE}' height='${CONFETTI_TILE}'>${pieces.map(confettiPiece).join("")}</svg>`,
  );
}
