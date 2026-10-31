import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Tooltip } from "#/components/Tooltip.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import type { Rect } from "#/utils/drawing.ts";
import {
  activeLayer,
  addLayer,
  endJoin,
  type Layer,
  MAX_LAYER_NAME,
  MAX_LAYERS,
  moveLayer,
  removeLayer,
  renameLayer,
  type SketchHistory,
  selectLayer,
  setLayerOpacity,
  toggleLayer,
} from "#/utils/drawingLayers.ts";
import { drawMarks } from "#/utils/drawingRender.ts";
import { phonePanel, SidePanel } from "./SidePanel.tsx";

const rowButton =
  "p-1.5 rounded-md text-neutral-100 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default";

/** The width of the picture of a layer in its row, in CSS pixels. */
const THUMB_WIDTH = 40;

/**
 * The ink of one layer, small, on white paper. Only the marks of the layer:
 * thus, an eraser takes away only its own ink here too.
 */
function LayerThumb({ layer, view }: { layer: Layer; view: Rect }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const height = Math.max(
    1,
    Math.round((THUMB_WIDTH * view.height) / view.width),
  );
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const scale = THUMB_WIDTH / view.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, THUMB_WIDTH, height);
    ctx.setTransform(scale, 0, 0, scale, -view.x * scale, -view.y * scale);
    drawMarks(ctx, layer.marks);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [layer.marks, view.x, view.y, view.width, height]);
  return (
    <canvas
      ref={ref}
      width={THUMB_WIDTH}
      height={height}
      class="shrink-0 w-10 max-h-8 object-contain rounded-sm bg-white ring-1 ring-white/20"
    />
  );
}

/** The name of a layer: its own, or "Layer" and its number. */
export const layerName = (layer: Layer): string =>
  layer.name ?? t("drawing.layerName", { n: layer.id });

/**
 * The field that renames a layer, in place of its name. Enter or a move of
 * focus away keeps the name, and Escape keeps the old one.
 */
function NameField({
  layer,
  onRename,
  onEnd,
}: {
  layer: Layer;
  onRename: (name: string) => void;
  onEnd: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Escape ends the edit before it reaches the panel. A ref, because the
  // blur that follows the end must not keep the name.
  const cancelled = useRef(false);
  useEscapeStack(true, () => {
    cancelled.current = true;
    onEnd();
  });
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      type="text"
      class="flex-1 min-w-0 rounded-md bg-neutral-900 px-1.5 py-1 text-sm text-neutral-100 outline-none ring-1 ring-blue-400"
      defaultValue={layerName(layer)}
      maxLength={MAX_LAYER_NAME}
      aria-label={t("drawing.layerNameField", { name: layerName(layer) })}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onBlur={(event) => {
        if (!cancelled.current) onRename(event.currentTarget.value);
        onEnd();
      }}
    />
  );
}

/** A button of the bottom row, with only an icon, and its name on hover. */
function ActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: ComponentChildren;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        class={rowButton}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The layers of the drawing on the pad, the top one first, as in the picture.
 * On a wide screen, a panel at the right of the paper, always there. On a
 * phone, a panel that the layers button opens.
 *
 * The opacity of the current layer is at the top. Each row has the eye that
 * hides or shows the layer, a picture of its ink, and its name. A press on a
 * row makes that layer the one the pen draws on, and a double press, or the
 * pencil at the bottom, renames it. The buttons at the bottom add a layer,
 * and rename, move or delete the current one. Each change, but the
 * choice of a layer, is one step that undo takes back.
 */
export function DrawingLayers({
  open,
  history,
  view,
  onChange,
  onClose,
}: {
  open: boolean;
  history: SketchHistory;
  /** The part of the paper that the picture shows. */
  view: Rect;
  onChange: (next: SketchHistory) => void;
  onClose: () => void;
}) {
  useEscapeStack(open, onClose);
  const { layers, active } = history.present;
  const current = activeLayer(history.present);
  const at = layers.findIndex((layer) => layer.id === active);
  const opacity = Math.round((current?.opacity ?? 1) * 100);
  const currentName = current ? layerName(current) : "";
  /** The layer whose name is a field. */
  const [naming, setNaming] = useState<number | null>(null);

  return (
    <SidePanel label={t("drawing.layers")} class={phonePanel(open)}>
      {current && (
        <label class="flex items-center gap-2 px-1 pb-2 text-sm">
          <Eye class="w-4 h-4 shrink-0 text-neutral-400" aria-hidden="true" />
          <span class="sr-only">
            {t("drawing.layerOpacity", { name: currentName })}
          </span>
          <input
            type="range"
            class="flex-1 min-w-0 accent-blue-500"
            min={0}
            max={100}
            step={5}
            value={opacity}
            onInput={(event) =>
              onChange(
                setLayerOpacity(
                  history,
                  current.id,
                  Number(event.currentTarget.value) / 100,
                ),
              )
            }
            // A slide that ends where it started sends no change.
            onChange={() => onChange(endJoin(history))}
            onPointerUp={() => onChange(endJoin(history))}
          />
          <span class="w-9 text-right tabular-nums">{opacity}%</span>
        </label>
      )}
      <ul class="flex flex-col gap-0.5">
        {[...layers].reverse().map((layer) => {
          const name = layerName(layer);
          return (
            <li
              key={layer.id}
              class={`flex items-center gap-1 rounded-md pl-0.5 ${layer.id === active ? "bg-white/15" : ""}`}
            >
              <button
                type="button"
                class={rowButton}
                onClick={() => onChange(toggleLayer(history, layer.id))}
                aria-label={t(
                  layer.visible ? "drawing.hideLayer" : "drawing.showLayer",
                  { name },
                )}
              >
                {layer.visible ? (
                  <Eye class="w-4 h-4" />
                ) : (
                  <EyeOff class="w-4 h-4 text-neutral-500" />
                )}
              </button>
              {naming === layer.id ? (
                <div class="flex flex-1 min-w-0 items-center gap-2 py-1 pr-1">
                  <LayerThumb layer={layer} view={view} />
                  <NameField
                    layer={layer}
                    onRename={(next) =>
                      onChange(renameLayer(history, layer.id, next))
                    }
                    onEnd={() => setNaming(null)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  class={`flex flex-1 min-w-0 items-center gap-2 py-1 pr-2 text-left text-sm cursor-pointer ${layer.visible ? "" : "text-neutral-500"}`}
                  onClick={() => onChange(selectLayer(history, layer.id))}
                  onDblClick={() => {
                    onChange(selectLayer(history, layer.id));
                    setNaming(layer.id);
                  }}
                  aria-pressed={layer.id === active}
                >
                  <LayerThumb layer={layer} view={view} />
                  <span class="truncate">{name}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div class="mt-1 flex items-center justify-end gap-0.5 border-t border-white/10 pt-1">
        <ActionButton
          label={t("drawing.addLayer")}
          onClick={() => onChange(addLayer(history))}
          disabled={layers.length >= MAX_LAYERS}
        >
          <Plus class="w-4 h-4" />
        </ActionButton>
        <ActionButton
          label={t("drawing.renameLayer", { name: currentName })}
          onClick={() => setNaming(active)}
          disabled={!current}
        >
          <Pencil class="w-4 h-4" />
        </ActionButton>
        <ActionButton
          label={t("drawing.layerUp", { name: currentName })}
          onClick={() => onChange(moveLayer(history, active, 1))}
          disabled={at < 0 || at === layers.length - 1}
        >
          <ArrowUp class="w-4 h-4" />
        </ActionButton>
        <ActionButton
          label={t("drawing.layerDown", { name: currentName })}
          onClick={() => onChange(moveLayer(history, active, -1))}
          disabled={at <= 0}
        >
          <ArrowDown class="w-4 h-4" />
        </ActionButton>
        <ActionButton
          label={t("drawing.deleteLayer", { name: currentName })}
          onClick={() => onChange(removeLayer(history, active))}
          disabled={layers.length <= 1}
        >
          <Trash2 class="w-4 h-4" />
        </ActionButton>
      </div>
    </SidePanel>
  );
}
