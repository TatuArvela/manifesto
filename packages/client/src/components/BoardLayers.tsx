import { effect, signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { boardImageUrl } from "#/state/board.ts";
import {
  boardGradientMoves,
  boardTextureMoves,
  resolvedBoardGradientDirection,
} from "#/state/boardBackground.ts";
import {
  type BoardGradientDirection,
  type BoardTexture,
  boardGradientSpeed,
  boardTextureOpacity,
  boardTextureSpeed,
  boardUsePicture,
} from "#/state/prefs.ts";
import type { RollWay } from "#/utils/boardMotion.ts";
import { BoardPainter, canPaintBoard, rgbOf } from "#/utils/boardPainter.ts";
import { type MovingTexture, SHEET_COUNTS } from "#/utils/boardTextures.ts";

/**
 * The pattern in its sheets, each its own layer with its own motion
 * (`SHEET_COUNTS` in utils/boardTextures.ts). They exist only while the pattern
 * moves (`boardTextureMoves`), and each moves with `translate`, `transform` and
 * `opacity` alone, which the compositor plays with no paint (board-motion.css).
 * While they show, the still pattern under them is hidden. The rolling gradient
 * needs no element: it is the `::after` of the frame.
 */
export function BoardSheets({ texture }: { texture: BoardTexture }) {
  if (!boardTextureMoves.value || texture === "none") return null;
  return (
    <div class="board-sheets" data-texture={texture} aria-hidden="true">
      {Array.from({ length: SHEET_COUNTS[texture] }, (_, k) => (
        <span
          key={k}
          style={{
            maskImage: `var(--board-sheet-${texture}-${k})`,
            "--k": String(k),
          }}
        />
      ))}
    </div>
  );
}

/**
 * True after the painter failed (no WebGL 2, or a lost context). For the rest
 * of the session, the board then moves its pattern in its CSS sheets, and rolls
 * its gradient on the `::after` of the frame.
 */
const painterFailed = signal(false);

/** Where each direction of the gradient goes, across and down. */
const ROLL_WAYS: Record<BoardGradientDirection, RollWay> = {
  top: [0, -1],
  "top-right": [1, -1],
  right: [1, 0],
  "bottom-right": [1, 1],
  bottom: [0, 1],
  "bottom-left": [-1, 1],
  left: [-1, 0],
  "top-left": [-1, -1],
};

/**
 * The motion of the board: its moving pattern and its rolling gradient. A
 * worker paints both with WebGL on one canvas (utils/boardPainter.ts). Each
 * frame is then one layer and one draw, with no work on the main thread, at
 * no more than `BOARD_FRAME_RATE`. Where the browser cannot do that, the board
 * shows the CSS sheets and the CSS roll. The tiles and the preview in Settings
 * keep those: they are small, and each canvas would need its own WebGL
 * context.
 */
export function MovingBoard({ texture }: { texture: BoardTexture }) {
  // Under a picture, the board does not show. Thus, nothing paints it.
  if (boardImageUrl.value && boardUsePicture.value) return null;
  const pattern =
    boardTextureMoves.value && texture !== "none" ? texture : null;
  if (!pattern && !boardGradientMoves.value) return null;
  if (painterFailed.value || !canPaintBoard()) {
    return pattern ? <BoardSheets texture={pattern} /> : null;
  }
  return <BoardCanvas texture={pattern} />;
}

function BoardCanvas({ texture }: { texture: MovingTexture | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<BoardPainter | null>(null);
  const [scale, setScale] = useState(() => devicePixelRatio);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const painter = new BoardPainter(canvas, (reason) => {
      console.warn(
        `The board painter stopped (${reason}). CSS moves the board.`,
      );
      painterFailed.value = true;
    });
    painterRef.current = painter;

    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      painter.setSize(width, height, devicePixelRatio);
      setScale(devicePixelRatio);
    });
    // The device box also reports a new scale with the same size (a window
    // moved to another screen). Not all browsers have it.
    try {
      resize.observe(canvas, { box: "device-pixel-content-box" });
    } catch {
      resize.observe(canvas);
    }

    // The ink and the colors of the gradient follow the theme, the hue and the
    // choices of the board, which all are attributes or properties of the root.
    // The canvas has them as CSS colors (board-background.css), which is how
    // the browser resolves them.
    let ink = "";
    let roll = "";
    const readColors = () => {
      const style = getComputedStyle(canvas);
      if (style.color !== ink) {
        ink = style.color;
        const rgb = rgbOf(ink);
        if (rgb) painter.setInk(rgb);
      }
      const way = boardGradientMoves.peek()
        ? ROLL_WAYS[resolvedBoardGradientDirection.peek()]
        : null;
      const key = way
        ? `${style.borderTopColor} ${style.borderBottomColor} ${way.join()}`
        : "";
      if (key === roll) return;
      roll = key;
      const from = rgbOf(style.borderTopColor);
      const to = rgbOf(style.borderBottomColor);
      painter.setRoll(way && from && to ? { from, to, way } : null);
    };
    readColors();
    const watch = new MutationObserver(readColors);
    watch.observe(document.documentElement, { attributes: true });
    const stopRoll = effect(() => {
      // Read for the effect to run again on each change.
      void boardGradientMoves.value;
      void resolvedBoardGradientDirection.value;
      readColors();
    });

    const showing = () =>
      painter.setRunning(document.visibilityState === "visible");
    showing();
    document.addEventListener("visibilitychange", showing);
    const stopSettings = effect(() => {
      painter.setSpeed(boardTextureSpeed.value / 100);
      painter.setRollSpeed(boardGradientSpeed.value / 100);
      painter.setOpacity(boardTextureOpacity.value / 100);
    });

    return () => {
      resize.disconnect();
      watch.disconnect();
      document.removeEventListener("visibilitychange", showing);
      stopRoll();
      stopSettings();
      painter.stop();
      painterRef.current = null;
    };
  }, []);

  useEffect(() => {
    void painterRef.current?.setPattern(texture, scale);
  }, [texture, scale]);

  return (
    <div
      class="board-canvas"
      data-roll={boardGradientMoves.value ? "" : undefined}
      aria-hidden="true"
    >
      <canvas ref={ref} />
    </div>
  );
}
