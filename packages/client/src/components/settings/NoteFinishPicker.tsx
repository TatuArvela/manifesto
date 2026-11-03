import { t } from "#/i18n/index.ts";
import { NOTE_FINISHES, type NoteFinish } from "#/state/prefParsers.ts";
import { noteFinish } from "#/state/prefs.ts";
import { SettingsTiles } from "./SettingsControls.tsx";

/**
 * The card of each sample, as the finish draws it (note-cards.css), at the
 * size of the sample. The rules of the board apply only to the cards on the
 * board. Thus, the sample draws its own card.
 */
const SAMPLE_CARDS: Record<NoteFinish, string> = {
  matte: "shadow-sm bg-yellow-200 dark:bg-yellow-800",
  glossy:
    "shadow-sm bg-yellow-200/80 dark:bg-yellow-800/90 bg-linear-160 from-white/50 via-white/10 via-45% to-transparent to-70% dark:from-white/10 dark:via-white/5 backdrop-blur-[3px] border-t border-white/80 dark:border-white/20",
  glass:
    "bg-yellow-200/60 dark:bg-yellow-800/60 bg-[radial-gradient(140%_70%_at_50%_0%,rgb(255_255_255/0.55),rgb(255_255_255/0.15)_55%,transparent_75%)] dark:bg-[radial-gradient(140%_70%_at_50%_0%,rgb(255_255_255/0.05),transparent_75%)] backdrop-blur-[1px] backdrop-saturate-180 backdrop-contrast-70 backdrop-brightness-117 dark:backdrop-contrast-100 dark:backdrop-brightness-32 border border-white/60 dark:border-white/15 shadow-[0_1px_2px_rgb(0_0_0/0.05),inset_0_0_0_1px_rgb(255_255_255/0.5),inset_0_4px_5px_-4px_rgb(255_255_255/0.9),inset_0_-3px_4px_-3px_rgb(255_255_255/0.6)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.05),inset_0_0_0_1px_rgb(255_255_255/0.14),inset_0_4px_5px_-4px_rgb(255_255_255/0.3)]",
};

/**
 * A small board in each finish, with one card. The board is the plain board of
 * the Board Style samples, with thin lines in a near tone: sufficient to show
 * through a translucent card, and quiet enough not to draw the eye.
 */
function FinishSample({ finish }: { finish: NoteFinish }) {
  return (
    <span
      aria-hidden="true"
      class="relative grid place-items-center w-16 h-12 rounded-lg overflow-hidden ring-1 ring-inset ring-black/10 dark:ring-white/15 bg-neutral-100 dark:bg-neutral-700 bg-[repeating-linear-gradient(-45deg,var(--color-neutral-300)_0_1.5px,transparent_1.5px_6px)] dark:bg-[repeating-linear-gradient(-45deg,var(--color-neutral-500)_0_1.5px,transparent_1.5px_6px)]"
    >
      <span class={`w-10 h-8 rounded-[3px] ${SAMPLE_CARDS[finish]}`} />
    </span>
  );
}

/** The finish of the cards, as a sample board of each. */
export function NoteFinishPicker() {
  return (
    <SettingsTiles
      label={t("settings.noteFinish")}
      value={noteFinish.value}
      onChange={(next) => {
        noteFinish.value = next;
      }}
      options={NOTE_FINISHES.map((finish) => ({
        value: finish,
        label: t(`settings.noteFinish.${finish}`),
        sample: <FinishSample finish={finish} />,
      }))}
    />
  );
}
