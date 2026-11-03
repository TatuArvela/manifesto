/// <reference lib="webworker" />
import { BoardGl } from "./boardGl.ts";
import {
  frameDue,
  frameRateOf,
  rollShift,
  sheetStates,
} from "./boardMotion.ts";
import type { FromPainter, ToPainter } from "./boardPainterMessages.ts";
import type { MovingTexture } from "./boardTextures.ts";

/**
 * The board painter: the moving pattern and the rolling gradient of the board,
 * drawn with WebGL in this worker, on a canvas that the board gave it (boardPainter.ts). Thus, each frame
 * is one draw on one layer, and nothing of it runs on the main thread.
 *
 * The pattern and the gradient each have a time, which goes forward at the
 * speed of its slider. A new speed changes only how fast it goes from now.
 * Thus, the board does not jump.
 *
 * It draws no more than `BOARD_FRAME_RATE` frames each second, or the own rate
 * of a pattern that moves fast (`frameDue` and `frameRateOf` in
 * boardMotion.ts). On a frame that it skips, the canvas has nothing new, and
 * the browser composites nothing new for it.
 */
declare const self: DedicatedWorkerGlobalScope;

let painter: BoardGl | null = null;
let texture: MovingTexture | null = null;
let rate = 1;
let rollRate = 1;
let rolls = false;
let running = true;
/** The time of the pattern and of the gradient, in seconds at a speed of 100%. */
let time = 0;
let rollTime = 0;
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
    const step = Math.min((now - last) / 1000, MAX_STEP_SECONDS);
    time += step * rate;
    rollTime += step * rollRate;
  }
  last = now;
  const due = frameDue(now, lastDraw, frameRateOf(texture));
  if (due !== null) {
    lastDraw = due;
    painter.draw(
      texture ? sheetStates(texture, time) : [],
      rollShift(rollTime),
    );
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
    // A new size clears the canvas, and the other changes change the look.
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
    case "noSheets":
      painter.setSheets({ width: 1, height: 1, layers: [] });
      texture = null;
      lastDraw = null;
      break;
    case "ink":
      painter.setInk(message.rgb);
      lastDraw = null;
      break;
    case "opacity":
      painter.setOpacity(message.opacity);
      lastDraw = null;
      break;
    case "roll":
      painter.setRoll(message.roll);
      // A gradient that starts again starts from the look of the board.
      if (message.roll && !rolls) rollTime = 0;
      rolls = message.roll !== null;
      lastDraw = null;
      break;
    case "speed":
      rate = message.rate;
      break;
    case "rollSpeed":
      rollRate = message.rate;
      break;
    case "running":
      running = message.running;
      if (running) schedule();
      else stop();
      break;
  }
};
