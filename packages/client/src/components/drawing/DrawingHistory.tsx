import { useLayoutEffect, useRef } from "preact/hooks";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import {
  jumpTo,
  type Sketch,
  type SketchHistory,
  type Step,
} from "#/utils/drawingLayers.ts";

/** The name in the catalogues of each kind of step. */
const STEP_NAMES = {
  pen: "drawing.stepPen",
  eraser: "drawing.stepEraser",
  shape: "drawing.stepShape",
  fill: "drawing.stepFill",
  clearLayer: "drawing.stepClearLayer",
  addLayer: "drawing.stepAddLayer",
  removeLayer: "drawing.stepRemoveLayer",
  toggleLayer: "drawing.stepToggleLayer",
  layerOpacity: "drawing.stepLayerOpacity",
  moveLayer: "drawing.stepMoveLayer",
  orderLayer: "drawing.stepOrderLayer",
  cropLayer: "drawing.cropLayer",
  movePixels: "drawing.stepMovePixels",
  cropImage: "drawing.cropImage",
  canvasSize: "drawing.stepCanvasSize",
  imageSize: "drawing.stepImageSize",
} as const satisfies Record<Step, string>;

/** The name of the step that made a sketch, or of the start. */
const stepName = (sketch: Sketch) =>
  t(sketch.step ? STEP_NAMES[sketch.step] : "drawing.stepOpen");

/**
 * The steps of the drawing, the first at the top, as a list to go back to. A
 * press on a step shows the drawing as it was after it, as that many undos.
 * The steps after it stay, paler, until a new change replaces them.
 *
 * On a wide screen, a section at the right of the paper. On a phone, a panel
 * that its button opens.
 */
export function DrawingHistory({
  open,
  history,
  onChange,
  onClose,
}: {
  open: boolean;
  history: SketchHistory;
  onChange: (next: SketchHistory) => void;
  onClose: () => void;
}) {
  useEscapeStack(open, onClose);
  const list = useRef<HTMLOListElement>(null);
  const steps = [...history.past, history.present, ...history.future];
  const at = history.past.length;

  // The current step stays in sight as steps are added below it.
  useLayoutEffect(() => {
    list.current
      ?.querySelector('[aria-current="step"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [at, steps.length]);

  return (
    <section
      class={`${open ? "block" : "hidden"} absolute right-2 bottom-full mb-1 w-64 max-w-[calc(100vw-1rem)] rounded-lg bg-neutral-800 p-1 shadow-lg ring-1 ring-white/10 md:static md:block md:w-auto md:max-w-none md:p-2 md:shadow-none md:ring-0`}
      aria-label={t("drawing.history")}
    >
      <h2 class="hidden md:block px-1 pb-2 text-xs font-medium text-neutral-400">
        {t("drawing.history")}
      </h2>
      <ol ref={list} class="max-h-48 overflow-y-auto m-0 p-0 list-none">
        {steps.map((sketch, i) => (
          // The steps only change at the end, and keep their places.
          <li key={i}>
            <button
              type="button"
              class={`w-full rounded-md px-2 py-1 text-left text-sm cursor-pointer ${i === at ? "bg-blue-600 text-white" : i > at ? "text-neutral-500 hover:bg-white/10" : "hover:bg-white/10"}`}
              onClick={() => onChange(jumpTo(history, i))}
              aria-current={i === at ? "step" : undefined}
            >
              {stepName(sketch)}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
