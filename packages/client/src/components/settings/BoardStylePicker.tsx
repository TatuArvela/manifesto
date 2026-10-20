import { t } from "#/i18n/index.ts";
import type { NoteTilt } from "#/state/prefParsers.ts";
import { noteTilt } from "#/state/prefs.ts";
import { SettingsTiles } from "./SettingsControls.tsx";

/**
 * The four cards of the sample: their color, and how far each leans when messy.
 */
const SAMPLE_CARDS = [
  { bg: "bg-yellow-200 dark:bg-yellow-800", tilt: -5 },
  { bg: "bg-sky-200 dark:bg-sky-800", tilt: 4 },
  { bg: "bg-green-200 dark:bg-green-800", tilt: 3 },
  { bg: "bg-pink-200 dark:bg-pink-800", tilt: -4 },
] as const;

/**
 * A small board in each style, with four cards in a grid that lean a few
 * degrees on the messy board. The real tilt is only one or two degrees, which
 * would not show at this size. Thus, the sample leans more.
 */
function BoardSample({ style }: { style: NoteTilt }) {
  return (
    <span
      aria-hidden="true"
      class="grid grid-cols-2 gap-1 w-16 h-12 p-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-700 ring-1 ring-inset ring-black/10 dark:ring-white/15"
    >
      {SAMPLE_CARDS.map(({ bg, tilt }) => (
        <span
          key={bg}
          class={`rounded-[3px] shadow-sm ${bg}`}
          style={style === "messy" ? { rotate: `${tilt}deg` } : undefined}
        />
      ))}
    </span>
  );
}

/** Board Style as a sample board of each. */
export function BoardStylePicker() {
  return (
    <SettingsTiles
      label={t("settings.noteTilt")}
      value={noteTilt.value}
      onChange={(next) => {
        noteTilt.value = next;
      }}
      options={(["tidy", "messy"] as const).map((style) => ({
        value: style,
        label: t(`settings.noteTilt.${style}`),
        sample: <BoardSample style={style} />,
      }))}
    />
  );
}
