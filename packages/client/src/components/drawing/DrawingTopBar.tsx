import { Check, Redo, Trash2, Undo, X, ZoomIn, ZoomOut } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { Tooltip } from "#/components/Tooltip.tsx";
import { t } from "#/i18n/index.ts";
import { barButton } from "./DrawingToolbar.tsx";

/**
 * The top bar of the pad: close, the title (or why the picture was not
 * saved), the zoom, undo, redo, clear, and Done.
 */
/** A button of the bar with only an icon, and its name on hover. */
function IconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ComponentChildren;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        class={barButton}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}

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
    <div class="[grid-area:top] flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
      <IconButton label={t("drawing.cancel")} onClick={props.onCancel}>
        <X class="w-5 h-5" />
      </IconButton>
      {props.failed ? (
        <span class="flex-1 text-sm font-medium text-red-300" role="alert">
          {t("drawing.saveFailed")}
        </span>
      ) : (
        <span class="flex-1 text-sm font-medium truncate">
          {t("drawing.title")}
        </span>
      )}
      <IconButton
        label={t("drawing.zoomOut")}
        onClick={props.onZoomOut}
        disabled={!props.canZoomOut}
      >
        <ZoomOut class="w-5 h-5" />
      </IconButton>
      <button
        type="button"
        class={`${barButton} w-14 text-xs tabular-nums`}
        onClick={props.onZoomFit}
        aria-label={t("drawing.zoomFit")}
      >
        {props.zoomPercent}%
      </button>
      <IconButton
        label={t("drawing.zoomIn")}
        onClick={props.onZoomIn}
        disabled={!props.canZoomIn}
      >
        <ZoomIn class="w-5 h-5" />
      </IconButton>
      <span class="w-px h-6 mx-1 bg-white/20" aria-hidden="true" />
      <IconButton
        label={t("editor.undo")}
        onClick={props.onUndo}
        disabled={!props.canUndo}
      >
        <Undo class="w-5 h-5" />
      </IconButton>
      <IconButton
        label={t("editor.redo")}
        onClick={props.onRedo}
        disabled={!props.canRedo}
      >
        <Redo class="w-5 h-5" />
      </IconButton>
      <IconButton
        label={t("drawing.clear")}
        onClick={props.onClear}
        disabled={!props.canClear}
      >
        <Trash2 class="w-5 h-5" />
      </IconButton>
      <button
        type="button"
        class={`${barButton} flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 md:px-3 text-sm font-medium`}
        onClick={props.onDone}
        disabled={props.saving}
        aria-label={t("editor.done")}
      >
        <Check class="w-5 h-5" />
        <span class="hidden md:inline">{t("editor.done")}</span>
      </button>
    </div>
  );
}
