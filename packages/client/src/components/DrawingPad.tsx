import { NoteColor } from "@manifesto/shared";
import { Check, Eraser, Trash2, Undo, X } from "lucide-preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useBackToClose } from "../hooks/useBackToClose.js";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { getColorLabel, t } from "../i18n/index.js";
import { askConfirmation } from "../state/confirm.js";
import { closeDrawing, drawingRequest } from "../state/drawing.js";
import {
  DRAWING_HEIGHT,
  DRAWING_WIDTH,
  drawingPoint,
  drawStroke,
  PAPER,
  renderDrawing,
  type Stroke,
} from "../utils/drawing.js";

const INKS = [
  { color: "#171717", name: null },
  { color: "#dc2626", name: NoteColor.Red },
  { color: "#2563eb", name: NoteColor.Blue },
  { color: "#16a34a", name: NoteColor.Green },
] as const;
/** Pen widths, in the drawing's own pixels. */
const WIDTHS = [4, 10, 22] as const;
/** The eraser is paper-coloured ink, wide enough to rub with. */
const ERASER_SCALE = 4;

const barButton =
  "p-2 rounded-lg text-neutral-100 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default";

/**
 * The drawing pad: a sheet of paper to draw on with a finger, a pen or a
 * mouse, which becomes an image on the note like any other attachment.
 *
 * One pointer draws at a time, the one that went down first; a second finger
 * is ignored rather than starting a line of its own, and no gesture of the
 * page (scroll, pinch, the swipe back) takes the stroke away, because the
 * canvas, and only the canvas, has `touch-action: none`. The stroke follows
 * the pointer through a capture, so it carries on past the edge of the paper
 * and ends cleanly when the system cancels the touch.
 */
export function DrawingPad() {
  const request = drawingRequest.value;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawing = useRef<{ pointerId: number; stroke: Stroke } | null>(null);
  // The drawing as it stood when the line in progress began, and the frame
  // that will next put that line over it.
  const beneath = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef(0);
  const [count, setCount] = useState(0);
  const [ink, setInk] = useState<string>(INKS[0].color);
  const [width, setWidth] = useState<number>(WIDTHS[1]);
  const [erasing, setErasing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const context = () => canvasRef.current?.getContext("2d") ?? null;

  const redraw = () => {
    const ctx = context();
    if (ctx) renderDrawing(ctx, strokesRef.current);
  };

  // The paper, before anything is drawn on it and before the first frame: a
  // canvas starts transparent, which over the pad's dark ground is black.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as the canvas arrives
  useLayoutEffect(redraw, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /**
   * The line in progress over the drawing beneath it, once a frame. Drawn on
   * top of itself at every move instead, its soft edge would build up to
   * solid, and the line would thin as it was let go.
   */
  const paintActive = () => {
    frame.current = 0;
    const ctx = context();
    const active = drawing.current;
    if (!ctx || !active) return;
    if (beneath.current) ctx.drawImage(beneath.current, 0, 0);
    drawStroke(ctx, active.stroke);
  };

  /** Makes the line in progress, if there is one, part of the drawing. */
  const commitStroke = () => {
    const active = drawing.current;
    if (!active) return;
    drawing.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    strokesRef.current = [...strokesRef.current, active.stroke];
    setCount(strokesRef.current.length);
    redraw();
  };

  const discard = async () => {
    const confirmed = await askConfirmation({
      title: t("drawing.discardConfirm"),
      confirmLabel: t("drawing.discard"),
    });
    if (confirmed) closeDrawing();
  };

  /**
   * Closes the pad, asking first when there is a drawing to lose. False when
   * it stays open to ask, which is what keeps Back the pad's own meanwhile.
   */
  const cancel = (): boolean => {
    // A line still being drawn is a drawing to lose too.
    commitStroke();
    if (strokesRef.current.length === 0) {
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
    // Done pressed with the pen still down keeps the line it was drawing.
    commitStroke();
    if (strokesRef.current.length === 0) {
      closeDrawing();
      return;
    }
    setSaving(true);
    setFailed(false);
    canvas.toBlob((blob) => {
      if (!blob) {
        // The pad stays, drawing and all, to be tried again: said here
        // because a toast would be underneath it.
        setSaving(false);
        setFailed(true);
        return;
      }
      request.onDone(
        new File([blob], t("drawing.fileName"), { type: "image/png" }),
      );
      closeDrawing();
    }, "image/png");
  };

  const onPointerDown = (event: PointerEvent) => {
    const canvas = canvasRef.current;
    // One line at a time: a second finger, or a palm, is not a second pen.
    if (!canvas || drawing.current || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer knows: the stroke still starts, it
      // only stops following past the paper's edge.
    }
    const stroke: Stroke = {
      color: erasing ? PAPER : ink,
      width: erasing ? width * ERASER_SCALE : width,
      points: [drawingPoint(event, canvas.getBoundingClientRect())],
    };
    beneath.current ??= document.createElement("canvas");
    beneath.current.width = DRAWING_WIDTH;
    beneath.current.height = DRAWING_HEIGHT;
    beneath.current.getContext("2d")?.drawImage(canvas, 0, 0);
    drawing.current = { pointerId: event.pointerId, stroke };
    paintActive();
  };

  const onPointerMove = (event: PointerEvent) => {
    const canvas = canvasRef.current;
    const active = drawing.current;
    if (!canvas || active?.pointerId !== event.pointerId) return;
    const shown = canvas.getBoundingClientRect();
    // Every position the pointer passed through since the last frame, where
    // the browser kept them: a fast hand otherwise draws corners.
    const events = event.getCoalescedEvents?.() ?? [];
    for (const each of events.length > 0 ? events : [event]) {
      active.stroke.points.push(drawingPoint(each, shown));
    }
    frame.current ||= requestAnimationFrame(paintActive);
  };

  const endStroke = (event: PointerEvent) => {
    if (drawing.current?.pointerId === event.pointerId) commitStroke();
  };

  const undo = () => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    setCount(strokesRef.current.length);
    redraw();
  };

  const clear = () => {
    strokesRef.current = [];
    setCount(0);
    redraw();
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("drawing.title")}
      class="fixed inset-0 z-[55] flex flex-col bg-neutral-900 text-neutral-100 animate-fade-in"
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
          onClick={undo}
          disabled={count === 0}
          aria-label={t("editor.undo")}
        >
          <Undo class="w-5 h-5" />
        </button>
        <button
          type="button"
          class={barButton}
          onClick={clear}
          disabled={count === 0}
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
      <div class="flex-1 min-h-0 flex items-center justify-center px-2">
        <canvas
          ref={canvasRef}
          width={DRAWING_WIDTH}
          height={DRAWING_HEIGHT}
          class="max-w-full max-h-full rounded-lg shadow-lg cursor-crosshair touch-none select-none"
          style={{ aspectRatio: `${DRAWING_WIDTH} / ${DRAWING_HEIGHT}` }}
          aria-label={t("drawing.paper")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        />
      </div>

      <div class="flex items-center justify-center gap-1 flex-wrap px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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
          class={`${barButton} ${erasing ? "bg-white/20" : ""}`}
          onClick={() => setErasing(!erasing)}
          aria-label={t("drawing.eraser")}
          aria-pressed={erasing}
        >
          <Eraser class="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
