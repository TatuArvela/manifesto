import type { Ref } from "preact";
import { t } from "#/i18n/index.ts";
import type { Rect } from "#/utils/drawing.ts";
import type { Selection } from "#/utils/selection.ts";
import {
  type CanvasBox,
  DrawingOverlay,
  SelectionDraft,
  SelectionOutline,
} from "./DrawingOverlay.tsx";
import type { PenSettings } from "./DrawingPen.tsx";
import { type Tool, toolCursor } from "./tools.ts";
import type { useSelectionTool } from "./useSelectionTool.ts";

/**
 * The stage is the screen: the paper at the place and the zoom of the view,
 * and a margin around it. The sheet under the screen gives the paper its
 * shadow, and its place to the tests. Over the screen: the box of the move
 * tool, the selection, the crop, and the circle of the pen.
 */
export function PadStage({
  stageRef,
  canvasRef,
  screenRef,
  cursorRef,
  view,
  box,
  stage,
  tool,
  ink,
  pen,
  moveBox,
  selection,
  selectTool,
  cropArea,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onPointerLeave,
  onDblClick,
}: {
  stageRef: Ref<HTMLDivElement>;
  canvasRef: Ref<HTMLCanvasElement>;
  screenRef: Ref<HTMLCanvasElement>;
  cursorRef: Ref<HTMLDivElement>;
  view: Rect;
  box: CanvasBox | null;
  stage: { width: number; height: number } | null;
  tool: Tool;
  ink: string;
  pen: PenSettings;
  /** The box of the ink of the active layer, as the drag of the move tool shows it. */
  moveBox: Rect | null;
  selection: Selection | null;
  selectTool: ReturnType<typeof useSelectionTool>;
  cropArea: Rect | null;
  onWheel: (event: WheelEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerEnd: (event: PointerEvent) => void;
  onPointerLeave: () => void;
  onDblClick: () => void;
}) {
  const erasing = tool === "eraser";
  const pixelRatio = window.devicePixelRatio || 1;
  return (
    <div
      ref={stageRef}
      class="[grid-area:stage] relative min-h-0 min-w-0 overflow-hidden"
      onWheel={onWheel}
    >
      <canvas ref={canvasRef} width={view.width} height={view.height} hidden />
      {box && (
        <div
          data-paper
          aria-hidden="true"
          class="absolute bg-white shadow-lg pointer-events-none"
          style={{
            left: `${box.left}px`,
            top: `${box.top}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
          }}
        />
      )}
      <canvas
        ref={screenRef}
        width={Math.max(1, Math.round((stage?.width ?? 1) * pixelRatio))}
        height={Math.max(1, Math.round((stage?.height ?? 1) * pixelRatio))}
        class="absolute inset-0 size-full touch-none select-none"
        style={{ cursor: toolCursor(tool) }}
        aria-label={t("drawing.paper")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerLeave}
        onDblClick={onDblClick}
      />
      {tool === "move" && box && moveBox && (
        <DrawingOverlay box={box} view={view} rect={moveBox} handle />
      )}
      {/* The selected area shows with every tool, as it limits them all. */}
      {box && selection && tool !== "move" && (
        <SelectionOutline
          box={box}
          view={view}
          selection={selection}
          offset={selectTool.offset}
        />
      )}
      {box && cropArea && (
        <DrawingOverlay box={box} view={view} rect={cropArea} dim />
      )}
      {box && selectTool.draft && (
        <SelectionDraft box={box} view={view} shape={selectTool.draft} />
      )}
      {/* Light and dark rings: it shows over any ink and over a photo. */}
      <div
        ref={cursorRef}
        aria-hidden="true"
        class={`absolute left-0 top-0 hidden pointer-events-none shadow-[0_0_0_1px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.9)] ${erasing ? "border border-dashed border-neutral-500" : ""}`}
        style={
          erasing
            ? undefined
            : {
                backgroundColor: ink,
                opacity: Math.max(0.15, pen.opacity * 0.5),
              }
        }
      />
    </div>
  );
}
