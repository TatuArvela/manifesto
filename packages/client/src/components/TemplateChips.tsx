import type { Note } from "@manifesto/shared";
import { LayoutTemplate } from "lucide-preact";
import { t } from "../i18n/index.js";
import { templateName, templates } from "../state/index.js";

/**
 * "Start from" in the composer: one chip for each of the user's templates.
 * Renders nothing when there are none, so the composer of someone who never
 * tagged a note `template` looks as it always did.
 */
export function TemplateChips({ onPick }: { onPick: (note: Note) => void }) {
  const list = templates.value;
  if (list.length === 0) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a border and a legend to a row of chips
    <div
      role="group"
      aria-label={t("templates.startFrom")}
      class="flex items-center gap-1.5 flex-wrap pb-2 text-xs max-h-24 overflow-y-auto"
    >
      <span
        class="inline-flex items-center gap-1 opacity-60"
        aria-hidden="true"
      >
        <LayoutTemplate class="w-3.5 h-3.5" />
        {t("templates.startFrom")}
      </span>
      {list.map((note) => (
        <button
          key={note.id}
          type="button"
          class="px-2 py-0.5 rounded-full cursor-pointer bg-neutral-200/60 dark:bg-neutral-700/60 hover:bg-neutral-300/70 dark:hover:bg-neutral-600/70 max-w-48 truncate"
          onClick={() => onPick(note)}
        >
          {templateName(note) || t("templates.untitled")}
        </button>
      ))}
    </div>
  );
}
