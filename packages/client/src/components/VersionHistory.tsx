import type { NoteColor, NoteVersion } from "@manifesto/shared";
import { ArrowLeft, RotateCcw } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { noteColorMap } from "../colors.js";
import { formatDateTime, t } from "../i18n/index.js";
import { getVersions } from "../storage/VersionStorage.js";
import { iconBtnClass } from "./NoteEditor.js";
import { Tooltip } from "./Tooltip.js";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

export function VersionHistory({
  noteId,
  color,
  onRestore,
  onClose,
}: {
  noteId: string;
  color: NoteColor;
  onRestore: (title: string, content: string) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [selected, setSelected] = useState<NoteVersion | null>(null);
  const colors = noteColorMap[color];

  useEffect(() => {
    setVersions(getVersions(noteId));
  }, [noteId]);

  if (selected) {
    return (
      <article class={`${colors.bg} ${colors.border} border shadow-lg`}>
        <div class="p-4">
          <div class="text-xs text-black/40 dark:text-white/40 mb-3">
            {formatDateTime(selected.timestamp)}
          </div>
          {selected.title && (
            <h3 class="font-medium text-base mb-2">{selected.title}</h3>
          )}
          <pre class="whitespace-pre-wrap text-sm max-h-80 overflow-y-auto">
            {selected.content || t("versions.emptyContent")}
          </pre>
        </div>
        <div class="px-3 pt-1.5 pb-2 flex items-center gap-0.5">
          <Tooltip label={t("versions.backToList")}>
            <button
              type="button"
              class={iconBtnClass}
              onClick={() => setSelected(null)}
              aria-label={t("versions.backToList")}
            >
              <ArrowLeft class="w-4 h-4" />
            </button>
          </Tooltip>
          <div class="flex-1" />
          <button
            type="button"
            class="px-3 py-1 text-sm rounded-full hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer flex items-center gap-1.5"
            onClick={() => onRestore(selected.title, selected.content)}
          >
            <RotateCcw class="w-3.5 h-3.5" />
            {t("versions.restore")}
          </button>
        </div>
      </article>
    );
  }

  return (
    <article class={`${colors.bg} ${colors.border} border shadow-lg`}>
      <div class="p-4">
        <h3 class="font-medium text-base mb-3">{t("versions.title")}</h3>
        {versions.length === 0 ? (
          <p class="text-sm text-black/40 dark:text-white/40">
            {t("versions.empty")}
          </p>
        ) : (
          <div class="flex flex-col gap-1 max-h-80 overflow-y-auto">
            {versions.map((v) => (
              <button
                key={v.timestamp}
                type="button"
                class="text-left px-3 py-2 rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                onClick={() => setSelected(v)}
              >
                <div class="text-xs text-black/40 dark:text-white/40">
                  {formatDateTime(v.timestamp)}
                </div>
                {v.title && (
                  <div class="text-sm font-medium mt-0.5">
                    {truncate(v.title, 60)}
                  </div>
                )}
                {v.content && (
                  <div class="text-xs text-black/60 dark:text-white/60 mt-0.5">
                    {truncate(v.content, 100)}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div class="px-3 pt-1.5 pb-2 flex items-center">
        <Tooltip label={t("versions.backToEditor")}>
          <button
            type="button"
            class={iconBtnClass}
            onClick={onClose}
            aria-label={t("versions.backToEditor")}
          >
            <ArrowLeft class="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
    </article>
  );
}
