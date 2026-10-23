import { Check, Redo, Trash2, Undo, X, ZoomIn, ZoomOut } from "lucide-preact";
import { t } from "#/i18n/index.ts";
import { barButton } from "./DrawingToolbar.tsx";

/**
 * The top bar of the pad: close, the title (or why the picture was not
 * saved), the zoom, undo, redo, clear, and Done.
 */
export function DrawingTopBar(props: {
  onCancel: () => void;
  failed: boolean;
  zoomPercent: number;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onZoomIn: () => void;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onClear: () => void;
  canClear: boolean;
  onDone: () => void;
  saving: boolean;
}) {
  return (
    <div class="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
      <button
        type="button"
        class={barButton}
        onClick={props.onCancel}
        aria-label={t("drawing.cancel")}
      >
        <X class="w-5 h-5" />
      </button>
      {props.failed ? (
        <span class="flex-1 text-sm font-medium text-red-300" role="alert">
          {t("drawing.saveFailed")}
        </span>
      ) : (
        <span class="flex-1 text-sm font-medium truncate">
          {t("drawing.title")}
        </span>
      )}
      <button
        type="button"
        class={barButton}
        onClick={props.onZoomOut}
        disabled={!props.canZoomOut}
        aria-label={t("drawing.zoomOut")}
      >
        <ZoomOut class="w-5 h-5" />
      </button>
      <button
        type="button"
        class={`${barButton} w-14 text-xs tabular-nums`}
        onClick={props.onZoomFit}
        aria-label={t("drawing.zoomFit")}
      >
        {props.zoomPercent}%
      </button>
      <button
        type="button"
        class={barButton}
        onClick={props.onZoomIn}
        disabled={!props.canZoomIn}
        aria-label={t("drawing.zoomIn")}
      >
        <ZoomIn class="w-5 h-5" />
      </button>
      <span class="w-px h-6 mx-1 bg-white/20" aria-hidden="true" />
      <button
        type="button"
        class={barButton}
        onClick={props.onUndo}
        disabled={!props.canUndo}
        aria-label={t("editor.undo")}
      >
        <Undo class="w-5 h-5" />
      </button>
      <button
        type="button"
        class={barButton}
        onClick={props.onRedo}
        disabled={!props.canRedo}
        aria-label={t("editor.redo")}
      >
        <Redo class="w-5 h-5" />
      </button>
      <button
        type="button"
        class={barButton}
        onClick={props.onClear}
        disabled={!props.canClear}
        aria-label={t("drawing.clear")}
      >
        <Trash2 class="w-5 h-5" />
      </button>
      <button
        type="button"
        class={`${barButton} bg-blue-600 hover:bg-blue-700`}
        onClick={props.onDone}
        disabled={props.saving}
        aria-label={t("editor.done")}
      >
        <Check class="w-5 h-5" />
      </button>
    </div>
  );
}
