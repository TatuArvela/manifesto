import { effect, signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { boardImageUrl } from "#/state/board.ts";
import {
  type BoardTexture,
  boardTextureMoves,
  boardTextureSpeed,
  boardUsePicture,
} from "#/state/prefs.ts";
import { BoardPainter, canPaintBoard, rgbOf } from "#/utils/boardPainter.ts";
import { type MovingTexture, SHEET_COUNTS } from "#/utils/boardTextures.ts";

/**
 * The pattern in its sheets, each its own layer with its own motion
 * (`SHEET_COUNTS` in utils/boardTextures.ts). They exist only while the pattern
 * moves (`boardTextureMoves`), and each moves with `translate`, `transform` and
 * `opacity` alone, which the compositor plays with no paint (preferences.css).
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
 * of the session, the board then moves its pattern in its CSS sheets.
 */
const painterFailed = signal(false);

/**
 * The moving pattern of the board. A worker paints it with WebGL on one canvas
 * (utils/boardPainter.ts). Each frame is then one layer and one draw, with no
 * work on the main thread, however many sheets the pattern has. Where the
 * browser cannot do that, the board shows the CSS sheets. The tiles in
 * Settings keep the sheets: they are small, and each canvas would need its own
 * WebGL context.
 */
export function BoardPattern({ texture }: { texture: BoardTexture }) {
  if (!boardTextureMoves.value || texture === "none") return null;
  // Under a picture, the pattern does not show. Thus, nothing paints it.
  if (boardImageUrl.value && boardUsePicture.value) return null;
  if (painterFailed.value || !canPaintBoard()) {
    return <BoardSheets texture={texture} />;
  }
  return <BoardCanvas texture={texture} />;
}

function BoardCanvas({ texture }: { texture: MovingTexture }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<BoardPainter | null>(null);
  const [scale, setScale] = useState(() => devicePixelRatio);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const painter = new BoardPainter(canvas, (reason) => {
      console.warn(
        `The board painter stopped (${reason}). CSS moves the pattern.`,
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

    // The ink follows the theme, the hue and the color of the pattern, which
    // all are attributes or properties of the root. The canvas has the ink as
    // its CSS color, which is how the browser resolves it.
    let ink = "";
    const readInk = () => {
      const color = getComputedStyle(canvas).color;
      if (color === ink) return;
      ink = color;
      const rgb = rgbOf(color);
      if (rgb) painter.setInk(rgb);
    };
    readInk();
    const watch = new MutationObserver(readInk);
    watch.observe(document.documentElement, { attributes: true });

    const showing = () =>
      painter.setRunning(document.visibilityState === "visible");
    showing();
    document.addEventListener("visibilitychange", showing);
    const stopSpeed = effect(() => {
      painter.setSpeed(boardTextureSpeed.value / 100);
    });

    return () => {
      resize.disconnect();
      watch.disconnect();
      document.removeEventListener("visibilitychange", showing);
      stopSpeed();
      painter.stop();
      painterRef.current = null;
    };
  }, []);

  useEffect(() => {
    void painterRef.current?.setPattern(texture, scale);
  }, [texture, scale]);

  return (
    <div class="board-canvas" aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}
