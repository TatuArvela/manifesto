import type { RollColors, SheetTiles } from "./boardGl.ts";
import type { MovingTexture } from "./boardTextures.ts";

/** What the board sends to its painter (boardPainter.worker.ts). */
export type ToPainter =
  | { kind: "start"; canvas: OffscreenCanvas }
  | { kind: "size"; width: number; height: number; scale: number }
  /** The sheets of a moving pattern, or none while the pattern is still. */
  | { kind: "sheets"; texture: MovingTexture; tiles: SheetTiles }
  | { kind: "noSheets" }
  | { kind: "ink"; rgb: readonly [number, number, number] }
  /** The opacity of the marks of the pattern, from 0 to 1. */
  | { kind: "opacity"; opacity: number }
  /** The rolling gradient, or null while it does not roll. */
  | { kind: "roll"; roll: RollColors | null }
  /** The speed of the pattern, where 1 is 100%. */
  | { kind: "speed"; rate: number }
  /** The speed of the rolling gradient, where 1 is 100%. */
  | { kind: "rollSpeed"; rate: number }
  /** False while nobody can see the board. */
  | { kind: "running"; running: boolean };

/** What the painter sends back: only that it cannot paint. */
export type FromPainter = { kind: "failed"; reason: string };
