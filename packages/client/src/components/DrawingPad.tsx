import { isStoredImageRef, NoteColor } from "@manifesto/shared";
import { Check, Eraser, Layers, Redo, Trash2, Undo, X } from "lucide-preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useBackToClose } from "#/hooks/useBackToClose.ts";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useFocusTrap } from "#/hooks/useFocusTrap.ts";
import { getColorLabel, t } from "#/i18n/index.ts";
import { attachmentObjectUrl } from "#/state/attachments.ts";
import { askConfirmation } from "#/state/confirm.ts";
import { closeDrawing, drawingRequest } from "#/state/drawing.ts";
import { showError } from "#/state/ui.ts";
import {
  BLANK_PAPER,
  blankCanvas,
  drawingPoint,
  drawStroke,
  encodeDrawing,
  PAPER,
  type PaperSize,
  paintLayer,
  paperSizeFor,
  penScale,
  renderDrawing,
  type Stroke,
} from "#/utils/drawing.ts";
import {
  activeLayer,
  addStroke,
  clearLayer,
  hasStrokes,
  hasVisibleStrokes,
  newSketchHistory,
  redo,
  type SketchHistory,
  undo,
} from "#/utils/drawingLayers.ts";
import { DrawingLayers } from "./DrawingLayers.tsx";

const INKS = [
  { color: "#171717", name: null },
  { color: "#dc2626", name: NoteColor.Red },
  { color: "#2563eb", name: NoteColor.Blue },
  { color: "#16a34a", name: NoteColor.Green },
] as const;
/** Pen widths, in the own pixels of a new drawing. */
const WIDTHS = [4, 10, 22] as const;
/** The eraser is ink in the color of the paper, wide enough to rub with. */
const ERASER_SCALE = 4;

const barButton =
  "p-2 rounded-lg text-neutral-100 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default";

/**
 * The drawing pad: a sheet of paper on which you draw with a finger, a pen or a
 * mouse. It becomes an image on the note, as all attachments do. When you open
 * it with one of the images of the note, that image is the paper, in its own
 * shape, and the new lines go over it.
 *
 * One pointer draws at a time, the pointer that went down first. The pad
 * ignores a second finger, and does not start a separate line for it. No
 * gesture of the page (scroll, pinch, the back swipe) takes the stroke away,
 * because only the canvas has `touch-action: none`. The stroke follows the
 * pointer through a capture. Thus, it continues past the edge of the paper, and
 * ends cleanly when the system cancels the touch.
 *
 * The drawing has layers, and each change is a step that undo takes back and
 * redo does again. All of it is for this session: Done flattens what shows into
 * one picture.
 */
export function DrawingPad() {
  const request = drawingRequest.value;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<SketchHistory>(newSketchHistory());
  const [history, setHistory] = useState(historyRef.current);
  const [layersOpen, setLayersOpen] = useState(false);
  const drawing = useRef<{ pointerId: number; stroke: Stroke } | null>(null);
  // While a line is drawn: the picture under its layer, that layer as it was,
  // the picture over it, and a canvas to put the line on the layer. Then the
  // frame that will next show it.
  const live = useRef<{
    under: HTMLCanvasElement;
    layer: HTMLCanvasElement;
    over: HTMLCanvasElement;
    scratch: HTMLCanvasElement;
  } | null>(null);
  const frame = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<string>(INKS[0].color);
  const [width, setWidth] = useState<number>(WIDTHS[1]);
  const [erasing, setErasing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [paper, setPaper] = useState<PaperSize>(BLANK_PAPER);
  const baseSrc = request?.base;
  const base = useRef<HTMLImageElement | null>(null);
  // Nothing is drawn until the image to draw over is available.
  const [ready, setReady] = useState(baseSrc === undefined);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const context = () => canvasRef.current?.getContext("2d") ?? null;

  const redraw = () => {
    const ctx = context();
    if (ctx) {
      renderDrawing(
        ctx,
        historyRef.current.present.layers,
        paper,
        base.current,
      );
    }
  };

  /** The drawing after a change, on the canvas and in the controls. */
  const apply = (next: SketchHistory) => {
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
    redraw();
  };

  // The paper, before anything is drawn on it and before the first frame. A
  // canvas starts transparent, which looks black over the dark ground of the
  // pad. It is emptied again when the image to draw over gives it a new size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: as the canvas arrives, and as its paper changes
  useLayoutEffect(redraw, [paper, ready]);

  useEffect(() => {
    if (baseSrc === undefined) return;
    let live = true;
    const fail = () => {
      if (!live) return;
      showError(t("drawing.openFailed"));
      closeDrawing();
    };
    const url = isStoredImageRef(baseSrc)
      ? attachmentObjectUrl(baseSrc)
      : Promise.resolve(baseSrc);
    void url.then((src) => {
      if (!live) return;
      if (src === null) {
        fail();
        return;
      }
      const image = new Image();
      image.onload = () => {
        if (!live) return;
        const size = paperSizeFor({
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        if (!size) {
          fail();
          return;
        }
        base.current = image;
        setPaper(size);
        setReady(true);
      };
      image.onerror = fail;
      image.src = src;
    });
    return () => {
      live = false;
    };
  }, [baseSrc]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /**
   * The current line over the drawing under it, one time in each frame. If the
   * code drew it on top of itself at each move, its soft edge would become
   * solid, and the line would become thinner at the release.
   */
  const paintActive = () => {
    frame.current = 0;
    const ctx = context();
    const active = drawing.current;
    const canvases = live.current;
    if (!ctx || !active || !canvases) return;
    const { under, layer, over, scratch } = canvases;
    const scratchCtx = scratch.getContext("2d");
    if (!scratchCtx) return;
    scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
    scratchCtx.drawImage(layer, 0, 0);
    drawStroke(scratchCtx, active.stroke);
    ctx.drawImage(under, 0, 0);
    ctx.drawImage(scratch, 0, 0);
    ctx.drawImage(over, 0, 0);
  };

  /** Makes the current line, if there is one, part of the drawing. */
  const commitStroke = () => {
    const active = drawing.current;
    if (!active) return;
    drawing.current = null;
    live.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    apply(addStroke(historyRef.current, active.stroke));
  };

  const discard = async () => {
    const confirmed = await askConfirmation({
      title: t("drawing.discardConfirm"),
      confirmLabel: t("drawing.discard"),
    });
    if (confirmed) closeDrawing();
  };

  /**
   * Closes the pad. It asks first when there is a drawing to lose. False when
   * it stays open to ask. That keeps Back for the pad in the meantime.
   */
  const cancel = (): boolean => {
    // A line that is still in progress is also a drawing to lose.
    commitStroke();
    if (!hasStrokes(historyRef.current.present)) {
      closeDrawing();
      return true;
    }
    void discard();
    return false;
  };

  useEscapeStack(true, () => {
    cancel();
  });
  useBackToClose(true, cancel);

  const done = () => {
    const canvas = canvasRef.current;
    if (!canvas || !request || saving) return;
    // Done, pushed with the pen still down, keeps the current line.
    commitStroke();
    // Only what shows is the picture. Hidden layers alone change nothing.
    if (!hasVisibleStrokes(historyRef.current.present)) {
      closeDrawing();
      return;
    }
    setSaving(true);
    setFailed(false);
    void encodeDrawing(canvas, base.current !== null).then((blob) => {
      if (!blob) {
        // The pad stays, with the drawing, for a new try. The message is here,
        // because a toast would be under the pad.
        setSaving(false);
        setFailed(true);
        return;
      }
      const name = t("drawing.fileName");
      request.onDone(
        new File(
          [blob],
          blob.type === "image/png" ? name : name.replace(/\.png$/, ".jpg"),
          { type: blob.type },
        ),
      );
      closeDrawing();
    });
  };

  const onPointerDown = (event: PointerEvent) => {
    const canvas = canvasRef.current;
    // One line at a time. A second finger, or a palm, is not a second pen.
    if (!canvas || !ready || drawing.current || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that the browser does not know now: the stroke still starts.
      // It only stops to follow past the edge of the paper.
    }
    const stroke: Stroke = {
      color: erasing ? PAPER : ink,
      width: (erasing ? width * ERASER_SCALE : width) * penScale(paper),
      points: [drawingPoint(event, canvas.getBoundingClientRect(), paper)],
      ...(erasing ? { erase: true } : {}),
    };
    const { layers, active } = historyRef.current.present;
    const at = layers.findIndex((layer) => layer.id === active);
    const under = blankCanvas(paper);
    const over = blankCanvas(paper);
    const layer = blankCanvas(paper);
    const underCtx = under.getContext("2d");
    const overCtx = over.getContext("2d");
    if (underCtx) {
      renderDrawing(underCtx, layers.slice(0, at), paper, base.current);
    }
    if (overCtx) {
      renderDrawing(overCtx, layers.slice(at + 1), paper, null, true);
    }
    paintLayer(layer, layers[at]?.strokes ?? []);
    live.current = { under, layer, over, scratch: blankCanvas(paper) };
    drawing.current = { pointerId: event.pointerId, stroke };
    paintActive();
    showCursor(event);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.isPrimary) showCursor(event);
    const canvas = canvasRef.current;
    const active = drawing.current;
    if (!canvas || active?.pointerId !== event.pointerId) return;
    const shown = canvas.getBoundingClientRect();
    // Each position through which the pointer went since the last frame, where
    // the browser kept them. If not, a fast hand draws corners.
    const events = event.getCoalescedEvents?.() ?? [];
    for (const each of events.length > 0 ? events : [event]) {
      active.stroke.points.push(drawingPoint(each, shown, paper));
    }
    frame.current ||= requestAnimationFrame(paintActive);
  };

  const endStroke = (event: PointerEvent) => {
    if (drawing.current?.pointerId === event.pointerId) commitStroke();
    // A finger leaves the screen: there is no place to show the pen at.
    if (event.pointerType === "touch") hideCursor();
  };

  /**
   * The circle that the next stroke will fill, at the pointer, in the width of
   * the pen or the eraser as the paper shows it. Set on the element itself: a
   * render at each move of the pointer would cost a frame.
   */
  const showCursor = (event: PointerEvent) => {
    const cursor = cursorRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!cursor || !stage || !canvas || !ready) return;
    const shown = canvas.getBoundingClientRect();
    const around = stage.getBoundingClientRect();
    const strokeWidth =
      (erasing ? width * ERASER_SCALE : width) * penScale(paper);
    const size = Math.max(4, (strokeWidth * shown.width) / paper.width);
    cursor.style.display = "block";
    cursor.style.width = `${size}px`;
    cursor.style.height = `${size}px`;
    cursor.style.transform = `translate(${event.clientX - around.left - size / 2}px, ${event.clientY - around.top - size / 2}px)`;
  };

  const hideCursor = () => {
    if (cursorRef.current) cursorRef.current.style.display = "none";
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("drawing.title")}
      class="fixed inset-0 layer-drawing flex flex-col bg-neutral-900 text-neutral-100 animate-fade-in"
    >
      <div class="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <button
          type="button"
          class={barButton}
          onClick={() => void cancel()}
          aria-label={t("drawing.cancel")}
        >
          <X class="w-5 h-5" />
        </button>
        {failed ? (
          <span class="flex-1 text-sm font-medium text-red-300" role="alert">
            {t("drawing.saveFailed")}
          </span>
        ) : (
          <span class="flex-1 text-sm font-medium">{t("drawing.title")}</span>
        )}
        <button
          type="button"
          class={barButton}
          onClick={() => apply(undo(historyRef.current))}
          disabled={history.past.length === 0}
          aria-label={t("editor.undo")}
        >
          <Undo class="w-5 h-5" />
        </button>
        <button
          type="button"
          class={barButton}
          onClick={() => apply(redo(historyRef.current))}
          disabled={history.future.length === 0}
          aria-label={t("editor.redo")}
        >
          <Redo class="w-5 h-5" />
        </button>
        <button
          type="button"
          class={barButton}
          onClick={() => apply(clearLayer(historyRef.current))}
          disabled={!activeLayer(history.present)?.strokes.length}
          aria-label={t("drawing.clear")}
        >
          <Trash2 class="w-5 h-5" />
        </button>
        <button
          type="button"
          class={`${barButton} bg-blue-600 hover:bg-blue-700`}
          onClick={done}
          disabled={saving}
          aria-label={t("editor.done")}
        >
          <Check class="w-5 h-5" />
        </button>
      </div>

      {/* The paper keeps its shape and takes what room there is. */}
      <div
        ref={stageRef}
        class="relative flex-1 min-h-0 flex items-center justify-center px-2 overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          width={paper.width}
          height={paper.height}
          class="max-w-full max-h-full rounded-lg shadow-lg cursor-none touch-none select-none"
          style={{ aspectRatio: `${paper.width} / ${paper.height}` }}
          aria-label={t("drawing.paper")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={hideCursor}
        />
        {/* Light and dark rings: it shows over any ink and over a photo. */}
        <div
          ref={cursorRef}
          aria-hidden="true"
          class={`absolute left-0 top-0 hidden rounded-full pointer-events-none shadow-[0_0_0_1px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.9)] ${erasing ? "border border-dashed border-neutral-500" : ""}`}
          style={erasing ? undefined : { backgroundColor: `${ink}66` }}
        />
      </div>

      <div class="relative flex items-center justify-center gap-1 flex-wrap px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {INKS.map(({ color, name }) => (
          <button
            key={color}
            type="button"
            class={`w-8 h-8 rounded-full border-2 ring-1 ring-white/30 cursor-pointer ${!erasing && ink === color ? "border-white" : "border-transparent"}`}
            style={{ backgroundColor: color }}
            onClick={() => {
              setInk(color);
              setErasing(false);
            }}
            aria-label={name ? getColorLabel(name) : t("drawing.black")}
            aria-pressed={!erasing && ink === color}
          />
        ))}
        <span class="w-px h-6 mx-1 bg-white/20" aria-hidden="true" />
        {WIDTHS.map((each, i) => (
          <button
            key={each}
            type="button"
            class={`w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer ${width === each ? "bg-white/20" : "hover:bg-white/10"}`}
            onClick={() => setWidth(each)}
            aria-label={t("drawing.width", { n: i + 1 })}
            aria-pressed={width === each}
          >
            <span
              class="rounded-full bg-neutral-100"
              style={{ width: `${4 + i * 5}px`, height: `${4 + i * 5}px` }}
            />
          </button>
        ))}
        <span class="w-px h-6 mx-1 bg-white/20" aria-hidden="true" />
        <button
          type="button"
          class={`${barButton} ${layersOpen ? "bg-white/20" : ""}`}
          onClick={() => setLayersOpen(!layersOpen)}
          aria-label={t("drawing.layers")}
          aria-expanded={layersOpen}
        >
          <Layers class="w-5 h-5" />
        </button>
        <button
          type="button"
          class={`${barButton} ${erasing ? "bg-white/20" : ""}`}
          onClick={() => setErasing(!erasing)}
          aria-label={t("drawing.eraser")}
          aria-pressed={erasing}
        >
          <Eraser class="w-5 h-5" />
        </button>
        {layersOpen && (
          <DrawingLayers
            history={history}
            onChange={apply}
            onClose={() => setLayersOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
