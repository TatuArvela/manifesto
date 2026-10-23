import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-preact";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import {
  activeLayer,
  addLayer,
  endJoin,
  MAX_LAYERS,
  moveLayer,
  removeLayer,
  type SketchHistory,
  selectLayer,
  setLayerOpacity,
  toggleLayer,
} from "#/utils/drawingLayers.ts";

const rowButton =
  "p-1.5 rounded-md text-neutral-100 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default";

/**
 * The layers of the drawing on the pad, the top one first, as in the picture.
 * A press on a name makes that layer the one the pen draws on. Each other
 * control is one step that undo takes back.
 */
export function DrawingLayers({
  history,
  onChange,
  onClose,
}: {
  history: SketchHistory;
  onChange: (next: SketchHistory) => void;
  onClose: () => void;
}) {
  useEscapeStack(true, onClose);
  const { layers, active } = history.present;
  const top = layers.length - 1;
  const current = activeLayer(history.present);
  const opacity = Math.round((current?.opacity ?? 1) * 100);

  return (
    <fieldset
      class="absolute right-2 bottom-full mb-1 w-64 max-w-[calc(100vw-1rem)] rounded-lg bg-neutral-800 p-1 shadow-lg ring-1 ring-white/10 border-0 m-0 min-w-0"
      aria-label={t("drawing.layers")}
    >
      <ul class="flex flex-col gap-0.5">
        {[...layers.entries()].reverse().map(([at, layer]) => {
          const name = t("drawing.layerName", { n: layer.id });
          return (
            <li
              key={layer.id}
              class={`flex items-center gap-0.5 rounded-md ${layer.id === active ? "bg-white/15" : ""}`}
            >
              <button
                type="button"
                class={`flex-1 min-w-0 truncate px-2 py-1.5 text-left text-sm cursor-pointer ${layer.visible ? "" : "line-through"}`}
                onClick={() => onChange(selectLayer(history, layer.id))}
                aria-pressed={layer.id === active}
              >
                {name}
              </button>
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
                  <EyeOff class="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                class={rowButton}
                onClick={() => onChange(moveLayer(history, layer.id, 1))}
                disabled={at === top}
                aria-label={t("drawing.layerUp", { name })}
              >
                <ArrowUp class="w-4 h-4" />
              </button>
              <button
                type="button"
                class={rowButton}
                onClick={() => onChange(moveLayer(history, layer.id, -1))}
                disabled={at === 0}
                aria-label={t("drawing.layerDown", { name })}
              >
                <ArrowDown class="w-4 h-4" />
              </button>
              <button
                type="button"
                class={rowButton}
                onClick={() => onChange(removeLayer(history, layer.id))}
                disabled={layers.length <= 1}
                aria-label={t("drawing.deleteLayer", { name })}
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </li>
          );
        })}
      </ul>
      {current && (
        <label class="mt-1 flex items-center gap-2 px-2 py-1 text-sm">
          <span class="flex-1 truncate">
            {t("drawing.layerOpacity", {
              name: t("drawing.layerName", { n: current.id }),
            })}
          </span>
          <input
            type="range"
            class="w-24 accent-blue-500"
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
            onChange={() => onChange(endJoin(history))}
          />
          <span class="w-9 text-right tabular-nums">{opacity}%</span>
        </label>
      )}
      <button
        type="button"
        class="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default"
        onClick={() => onChange(addLayer(history))}
        disabled={layers.length >= MAX_LAYERS}
      >
        <Plus class="w-4 h-4" />
        {t("drawing.addLayer")}
      </button>
    </fieldset>
  );
}
