/// <reference lib="webworker" />
import { BoardGl } from "./boardGl.ts";
import { BOARD_FRAME_RATE, frameDue, sheetStates } from "./boardMotion.ts";
import type { FromPainter, ToPainter } from "./boardPainterMessages.ts";
import type { MovingTexture } from "./boardTextures.ts";

/**
 * The board painter: the moving pattern of the board, drawn with WebGL in this
 * worker, on a canvas that the board gave it (boardPainter.ts). Thus, each frame
 * is one draw on one layer, and nothing of it runs on the main thread.
 *
 * The time of the pattern goes forward at the speed of the slider. A new speed
 * changes only how fast it goes from now. Thus, the board does not jump.
 *
 * It draws no more than `BOARD_FRAME_RATE` frames each second (`frameDue` in
 * boardMotion.ts). On a frame that it skips, the canvas has nothing new, and
 * the browser composites nothing new for it.
 */
declare const self: DedicatedWorkerGlobalScope;

let painter: BoardGl | null = null;
let texture: MovingTexture | null = null;
let rate = 1;
let running = true;
/** The time of the pattern, in seconds at a speed of 100%. */
let time = 0;
let last: number | null = null;
/** The time that the last draw counts from, or null to draw on the next frame. */
let lastDraw: number | null = null;
let frame: number | null = null;

/**
 * The next frame. A worker that has no frames of its own (an older browser)
 * paints on a timer of about the same rate.
 */
const nextFrame: (paint: (now: number) => void) => number =
  typeof self.requestAnimationFrame === "function"
    ? (paint) => self.requestAnimationFrame(paint)
    : (paint) => self.setTimeout(() => paint(performance.now()), 16);
const cancelFrame: (frame: number) => void =
  typeof self.cancelAnimationFrame === "function"
    ? (frame) => self.cancelAnimationFrame(frame)
    : (frame) => self.clearTimeout(frame);

/** A long frame (a tab that came back) moves the pattern by no more than this. */
const MAX_STEP_SECONDS = 0.25;

function fail(reason: string) {
  painter = null;
  stop();
  self.postMessage({ kind: "failed", reason } satisfies FromPainter);
}

function paint(now: number) {
  frame = null;
  if (!painter || !running) return;
  if (painter.isLost()) {
    fail("lost");
    return;
  }
  if (last !== null) {
    time += Math.min((now - last) / 1000, MAX_STEP_SECONDS) * rate;
  }
  last = now;
  const due = frameDue(now, lastDraw, BOARD_FRAME_RATE);
  if (due !== null) {
    lastDraw = due;
    if (texture) painter.draw(sheetStates(texture, time));
  }
  schedule();
}

function schedule() {
  if (frame === null && running && painter) {
    frame = nextFrame(paint);
  }
}

function stop() {
  if (frame !== null) cancelFrame(frame);
  frame = null;
  last = null;
  lastDraw = null;
}

self.onmessage = (event: MessageEvent<ToPainter>) => {
  const message = event.data;
  if (message.kind === "start") {
    try {
      painter = new BoardGl(message.canvas);
    } catch (error) {
      fail(error instanceof Error ? error.message : "no WebGL");
      return;
    }
    message.canvas.addEventListener("webglcontextlost", () => fail("lost"));
    schedule();
    return;
  }
  if (!painter) return;
  switch (message.kind) {
    // A new size clears the canvas, and new sheets or ink change the look.
    // Thus, each of them draws on the next frame, not when the next draw is due.
    case "size":
      painter.setSize(message.width, message.height, message.scale);
      lastDraw = null;
      break;
    case "sheets":
      painter.setSheets(message.tiles);
      texture = message.texture;
      lastDraw = null;
      break;
    case "ink":
      painter.setInk(message.rgb);
      lastDraw = null;
      break;
    case "speed":
      rate = message.rate;
      break;
    case "running":
      running = message.running;
      if (running) schedule();
      else stop();
      break;
  }
};
