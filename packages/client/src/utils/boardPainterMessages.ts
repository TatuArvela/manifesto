import type { SheetTiles } from "./boardGl.ts";
import type { MovingTexture } from "./boardTextures.ts";

/** What the board sends to its painter (boardPainter.worker.ts). */
export type ToPainter =
  | { kind: "start"; canvas: OffscreenCanvas }
  | { kind: "size"; width: number; height: number; scale: number }
  | { kind: "sheets"; texture: MovingTexture; tiles: SheetTiles }
  | { kind: "ink"; rgb: readonly [number, number, number] }
  /** The speed, where 1 is 100%. */
  | { kind: "speed"; rate: number }
  /** False while nobody can see the board. */
  | { kind: "running"; running: boolean };

/** What the painter sends back: only that it cannot paint. */
export type FromPainter = { kind: "failed"; reason: string };
