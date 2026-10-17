import { NoteInk } from "@manifesto/shared";
import { Tooltip } from "#/components/Tooltip.tsx";
import { t } from "#/i18n/index.ts";

/** The swatch of each ink, as its text is drawn in either theme. */
const INK_SWATCHES: Record<NoteInk, string> = {
  [NoteInk.Default]: "bg-neutral-800 dark:bg-neutral-200",
  [NoteInk.Blue]: "bg-blue-700 dark:bg-blue-300",
  [NoteInk.Red]: "bg-red-700 dark:bg-red-300",
  [NoteInk.Green]: "bg-green-700 dark:bg-green-300",
  [NoteInk.Purple]: "bg-purple-700 dark:bg-purple-300",
};

export function inkLabel(ink: NoteInk): string {
  return ink === NoteInk.Default ? t("editor.ink.default") : t(`color.${ink}`);
}

/**
 * A row of the inks a note can be written in, for the font pickers of the
 * editor and the card. The current one is `aria-pressed`, which the card's
 * popover reads to put focus on it.
 */
export function InkPicker({
  value,
  onChange,
}: {
  value: NoteInk;
  onChange: (ink: NoteInk) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of toggle buttons, not a form's fieldset
    <div
      class="flex gap-1.5 px-1 py-1"
      role="group"
      aria-label={t("editor.ink")}
    >
      {Object.values(NoteInk).map((ink) => {
        const label = inkLabel(ink);
        return (
          <Tooltip key={ink} label={label}>
            <button
              type="button"
              class={`w-6 h-6 rounded-full cursor-pointer ${INK_SWATCHES[ink]} ${value === ink ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-neutral-800" : ""}`}
              onClick={() => onChange(ink)}
              aria-label={label}
              aria-pressed={value === ink}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}
