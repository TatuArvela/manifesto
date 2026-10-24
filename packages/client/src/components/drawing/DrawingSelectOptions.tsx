import {
  Image,
  type LucideIcon,
  Square,
  SquareDashed,
  SquaresIntersect,
  SquaresSubtract,
  SquaresUnite,
} from "lucide-preact";
import { Tooltip } from "#/components/Tooltip.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import type { SelectMode } from "#/utils/selection.ts";
import { optionsPanel } from "./DrawingPen.tsx";

/** What a drag inside the selected area moves: the area, or its ink. */
export type SelectionMove = "selection" | "pixels";

const MODES = [
  { mode: "replace", Icon: Square, label: "drawing.selectNew" },
  { mode: "add", Icon: SquaresUnite, label: "drawing.selectAdd" },
  { mode: "subtract", Icon: SquaresSubtract, label: "drawing.selectSubtract" },
  {
    mode: "intersect",
    Icon: SquaresIntersect,
    label: "drawing.selectIntersect",
  },
] as const satisfies readonly {
  mode: SelectMode;
  Icon: LucideIcon;
  label: string;
}[];

const MOVES = [
  { move: "selection", Icon: SquareDashed, label: "drawing.moveSelection" },
  { move: "pixels", Icon: Image, label: "drawing.movePixels" },
] as const satisfies readonly {
  move: SelectionMove;
  Icon: LucideIcon;
  label: string;
}[];

const segment = (on: boolean) =>
  `flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 cursor-pointer ${on ? "bg-blue-600 text-white" : "hover:bg-white/10"}`;

/**
 * The options of the selection tools. What a new shape does to the area: a
 * new area, added to it, taken away from it, or only the part that both
 * share. Shift adds, Alt takes away, and both keep the shared part, for one
 * drag, whatever the choice. Then what a drag that starts inside the
 * area moves: the area, or the ink in it.
 */
export function DrawingSelectOptions({
  mode,
  onMode,
  move,
  onMove,
  open,
  onClose,
}: {
  mode: SelectMode;
  onMode: (next: SelectMode) => void;
  move: SelectionMove;
  onMove: (next: SelectionMove) => void;
  open: boolean;
  onClose: () => void;
}) {
  useEscapeStack(open, onClose);
  return (
    <fieldset class={optionsPanel(open)} aria-label={t("drawing.selectMode")}>
      <div class="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
        {MODES.map(({ mode: each, Icon, label }) => (
          <Tooltip key={each} label={t(label)}>
            <button
              type="button"
              class={segment(mode === each)}
              onClick={() => onMode(each)}
              aria-label={t(label)}
              aria-pressed={mode === each}
            >
              <Icon class="w-4 h-4" />
            </button>
          </Tooltip>
        ))}
      </div>
      <fieldset
        class="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5 border-0 m-0 min-w-0"
        aria-label={t("drawing.moveTarget")}
      >
        {MOVES.map(({ move: each, Icon, label }) => (
          <button
            key={each}
            type="button"
            class={segment(move === each)}
            onClick={() => onMove(each)}
            aria-pressed={move === each}
          >
            <Icon class="w-4 h-4" />
            {t(label)}
          </button>
        ))}
      </fieldset>
    </fieldset>
  );
}
