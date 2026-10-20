import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { ControlLabelId } from "#/components/controlLabel.ts";
import { t } from "#/i18n/index.ts";
import {
  BOARD_COLORS,
  type BoardColor,
  DARK_HUES,
  type DarkHue,
  darkHue,
  LIGHT_HUES,
  type LightHue,
  lightHue,
  type ThemeMode,
  theme,
} from "#/state/prefs.ts";
import {
  type SettingsOption,
  SettingsSelect,
  SettingsTiles,
} from "./SettingsControls.tsx";

const swatchClass =
  "w-9 h-5 shrink-0 rounded ring-1 ring-inset ring-black/10 dark:ring-white/15";

/** Three columns, the same for the tiles and the shades under them. */
const columnsClass =
  "grid grid-cols-[repeat(3,5rem)] justify-items-center gap-x-3";

function isBoardColor(hue: string): hue is BoardColor {
  return (BOARD_COLORS as readonly string[]).includes(hue);
}

/**
 * One theme as a small window: the page in the shade selected for it, a bar
 * across the top, and three notes. Drawn in fixed colors, not `dark:` colors,
 * because the dark sample stays dark while the app is light.
 */
function ThemeWindow({ mode }: { mode: "light" | "dark" }) {
  const light = mode === "light";
  const cards = light
    ? ["bg-yellow-100", "bg-sky-100", "bg-pink-100"]
    : ["bg-yellow-900", "bg-sky-900", "bg-pink-900"];
  return (
    <span
      class={`absolute inset-0 flex flex-col ${light ? "light-hue-swatch" : "dark-hue-swatch"}`}
      {...(light
        ? { "data-light-hue": lightHue.value }
        : { "data-dark-hue": darkHue.value })}
    >
      <span class={`h-2.5 ${light ? "bg-black/5" : "bg-white/10"}`} />
      <span class="flex flex-1 gap-1 p-1.5">
        {cards.map((bg) => (
          <span
            key={bg}
            class={`flex-1 rounded-[3px] ${bg} ${light ? "shadow-sm" : "ring-1 ring-inset ring-white/10"}`}
          />
        ))}
      </span>
    </span>
  );
}

/**
 * The sample of a theme. The system sample is light and dark, split from corner
 * to corner.
 */
function ThemeSample({ mode }: { mode: ThemeMode }) {
  return (
    <span
      aria-hidden="true"
      class="relative block w-[4.5rem] h-12 rounded-lg overflow-hidden ring-1 ring-inset ring-black/10 dark:ring-white/15"
    >
      {mode !== "dark" && <ThemeWindow mode="light" />}
      {mode !== "light" && (
        <span
          class="absolute inset-0"
          style={
            mode === "system"
              ? { clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }
              : undefined
          }
        >
          <ThemeWindow mode="dark" />
        </span>
      )}
    </span>
  );
}

/**
 * The select of a shade, in the column of its theme. Its name is read out, not
 * shown, because the tile above tells which theme it is. For a settings search,
 * the column is its own row.
 */
function ShadeColumn({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  const labelId = useId();
  return (
    <div class="flex justify-center" data-setting-row>
      <h4 id={labelId} class="sr-only">
        {label}
      </h4>
      <ControlLabelId.Provider value={labelId}>
        {children}
      </ControlLabelId.Provider>
    </div>
  );
}

/**
 * The theme as a sample of each, with the light and dark shades under the light
 * and dark samples, which use them. You can select either shade whatever the
 * current theme, ready for when the other theme is on.
 */
export function ThemePicker() {
  const lightHueOptions: SettingsOption<LightHue>[] = LIGHT_HUES.map((hue) => ({
    value: hue,
    // The preset colors have the same names as the note colors.
    label: isBoardColor(hue)
      ? t(`color.${hue}`)
      : t(`settings.lightHue.${hue}`),
    preview: (
      <span data-light-hue={hue} class={`light-hue-swatch ${swatchClass}`} />
    ),
  }));
  const darkHueOptions: SettingsOption<DarkHue>[] = DARK_HUES.map((hue) => ({
    value: hue,
    label: isBoardColor(hue) ? t(`color.${hue}`) : t(`settings.darkHue.${hue}`),
    preview: (
      <span data-dark-hue={hue} class={`dark-hue-swatch ${swatchClass}`} />
    ),
  }));

  return (
    <div class="flex flex-col gap-2">
      <SettingsTiles
        class={columnsClass}
        label={t("settings.theme")}
        value={theme.value}
        onChange={(next) => {
          theme.value = next;
        }}
        options={(["system", "light", "dark"] as const).map((mode) => ({
          value: mode,
          label: t(`settings.theme.${mode}`),
          sample: <ThemeSample mode={mode} />,
        }))}
      />
      <div class={columnsClass}>
        <span />
        <ShadeColumn label={t("settings.lightHue")}>
          <SettingsSelect
            compact
            label={t("settings.lightHue")}
            value={lightHue.value}
            options={lightHueOptions}
            onChange={(next) => {
              lightHue.value = next;
            }}
          />
        </ShadeColumn>
        <ShadeColumn label={t("settings.darkHue")}>
          <SettingsSelect
            compact
            label={t("settings.darkHue")}
            value={darkHue.value}
            options={darkHueOptions}
            onChange={(next) => {
              darkHue.value = next;
            }}
          />
        </ShadeColumn>
      </div>
    </div>
  );
}
