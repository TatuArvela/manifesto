import type { SheetTiles } from "./boardGl.ts";
import type { FromPainter, ToPainter } from "./boardPainterMessages.ts";
import {
  type MovingTexture,
  type PaintedSheets,
  paintedSheets,
} from "./boardTextures.ts";

/**
 * If this browser can give a canvas to a worker. If not, the board moves its
 * pattern in its CSS sheets. If WebGL 2 is missing, the worker tells the board,
 * which then does the same.
 */
export function canPaintBoard(): boolean {
  return (
    typeof Worker === "function" &&
    typeof OffscreenCanvas === "function" &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function"
  );
}

let painted: Record<MovingTexture, PaintedSheets> | null = null;

/**
 * The sheets of `texture` as images, at `scale` device px for each CSS px. An
 * SVG can be drawn only on the main thread. Thus, the page draws them, and
 * gives the images to the worker. Each is small: one tile.
 */
async function drawSheets(
  texture: MovingTexture,
  scale: number,
): Promise<SheetTiles> {
  painted ??= paintedSheets();
  const { width, height, images } = painted[texture];
  const across = Math.max(1, Math.round(width * scale));
  const down = Math.max(1, Math.round(height * scale));
  const layers = await Promise.all(
    images.map(async (address) => {
      const image = new Image();
      image.src = address;
      await image.decode();
      const canvas = new OffscreenCanvas(across, down);
      canvas.getContext("2d")?.drawImage(image, 0, 0, across, down);
      return canvas.transferToImageBitmap();
    }),
  );
  return { width, height, layers };
}

let probe: OffscreenCanvasRenderingContext2D | null = null;

/** A CSS color as red, green and blue from 0 to 1, or null. */
export function rgbOf(color: string): [number, number, number] | null {
  probe ??= new OffscreenCanvas(1, 1).getContext("2d", {
    willReadFrequently: true,
  });
  if (!probe) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

/**
 * The page side of the board painter (boardPainter.worker.ts). It gives the
 * canvas to the worker, and sends it what the board shows. `onFail` is called
 * once if the worker cannot paint. After that, the painter does nothing.
 */
export class BoardPainter {
  private readonly worker: Worker;
  private generation = 0;
  private failed = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly onFail: (reason: string) => void,
  ) {
    this.worker = new Worker(
      new URL("./boardPainter.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = (event: MessageEvent<FromPainter>) =>
      this.fail(event.data.reason);
    this.worker.onerror = () => this.fail("worker");
    const offscreen = canvas.transferControlToOffscreen();
    this.send({ kind: "start", canvas: offscreen }, [offscreen]);
  }

  private send(message: ToPainter, transfer: Transferable[] = []) {
    if (!this.failed) this.worker.postMessage(message, transfer);
  }

  private fail(reason: string) {
    if (this.failed) return;
    this.failed = true;
    this.worker.terminate();
    this.onFail(reason);
  }

  setSize(width: number, height: number, scale: number) {
    this.send({ kind: "size", width, height, scale });
  }

  setInk(rgb: readonly [number, number, number]) {
    this.send({ kind: "ink", rgb });
  }

  /** The speed, where 1 is 100%. */
  setSpeed(rate: number) {
    this.send({ kind: "speed", rate });
  }

  setRunning(running: boolean) {
    this.send({ kind: "running", running });
  }

  /**
   * Draws the sheets of `texture` and sends them. A newer call wins. Never
   * rejects: a sheet that cannot be drawn makes the painter fail.
   */
  async setPattern(texture: MovingTexture, scale: number): Promise<void> {
    const mine = ++this.generation;
    try {
      const tiles = await drawSheets(texture, scale);
      if (mine !== this.generation || this.failed) {
        for (const layer of tiles.layers) layer.close();
        return;
      }
      this.send({ kind: "sheets", texture, tiles }, tiles.layers);
    } catch {
      this.fail("sheets");
    }
  }

  stop() {
    this.failed = true;
    this.generation++;
    this.worker.terminate();
  }
}
