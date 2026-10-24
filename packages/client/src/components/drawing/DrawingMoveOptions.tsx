import { Layers, SquareDashed } from "lucide-preact";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import { optionsPanel } from "./DrawingPen.tsx";

/** What a drag of the move tool moves: the ink of the layer, or the area. */
export type MoveTarget = "layer" | "selection";

const TARGETS = [
  { target: "layer", Icon: Layers, label: "drawing.moveLayer" },
  { target: "selection", Icon: SquareDashed, label: "drawing.moveSelection" },
] as const;

/**
 * The options of the move tool: it moves the ink of the current layer, or the
 * selected area without the ink in it. The area is a choice only while there
 * is one.
 */
export function DrawingMoveOptions({
  target,
  hasSelection,
  open,
  onChange,
  onClose,
}: {
  target: MoveTarget;
  hasSelection: boolean;
  open: boolean;
  onChange: (next: MoveTarget) => void;
  onClose: () => void;
}) {
  useEscapeStack(open, onClose);
  const current = hasSelection ? target : "layer";
  return (
    <fieldset class={optionsPanel(open)} aria-label={t("drawing.moveTarget")}>
      <div class="flex items-center gap-1 rounded-lg bg-white/5 p-0.5">
        {TARGETS.map(({ target: each, Icon, label }) => (
          <button
            key={each}
            type="button"
            class={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 cursor-pointer disabled:opacity-30 disabled:cursor-default ${current === each ? "bg-blue-600 text-white" : "hover:bg-white/10 disabled:hover:bg-transparent"}`}
            onClick={() => onChange(each)}
            disabled={each === "selection" && !hasSelection}
            aria-pressed={current === each}
          >
            <Icon class="w-4 h-4" />
            {t(label)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
