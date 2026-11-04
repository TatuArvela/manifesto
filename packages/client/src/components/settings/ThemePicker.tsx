import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { ControlLabelId } from "#/components/controlLabel.ts";
import { t } from "#/i18n/index.ts";
import {
  DARK_HUES,
  type DarkHue,
  darkCustomColor,
  darkHue,
  LIGHT_HUES,
  type LightHue,
  lightCustomColor,
  lightHue,
  type ThemeMode,
  theme,
} from "#/state/prefs.ts";
import { appliedDarkTint, appliedLightTint } from "#/state/theme.ts";
import {
  darkTint,
  lightTint,
  type ShadeColor,
  shadeColor,
  type Tint,
  tintProperties,
} from "#/utils/themeShades.ts";
import { CustomColorSwatch } from "./CustomColorSwatch.tsx";
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

/**
 * The tones of each sample, from the ramp of its own theme (`.light-ramp`,
 * `.dark-ramp`): the page and the top bar, the line under the bar, and the
 * plain note. Thus, the dark sample stays dark while the app is light.
 */
const windowTones = {
  light: {
    ramp: "light-ramp bg-white",
    bar: "bg-white border-neutral-200 shadow-xs",
    card: "bg-white border-neutral-200",
  },
  dark: {
    ramp: "dark-ramp bg-neutral-900",
    bar: "bg-neutral-900 border-neutral-700",
    card: "bg-neutral-800 border-neutral-700",
  },
} as const;

/**
 * One theme as a small window in its shade: the page, a bar across the top,
 * and two plain notes in outline. The notes are quiet on purpose. The shade
 * is what the tile shows, and colored notes took the eye from it.
 */
function ThemeWindow({ mode }: { mode: "light" | "dark" }) {
  const tones = windowTones[mode];
  return (
    <span class={`absolute inset-0 flex flex-col ${tones.ramp}`}>
      <span class={`h-2.5 shrink-0 border-b ${tones.bar}`} />
      <span class="flex flex-1 items-start gap-1 p-1.5">
        <span class={`flex-1 h-5 rounded-[3px] border ${tones.card}`} />
        <span class={`flex-1 h-3.5 rounded-[3px] border ${tones.card}`} />
      </span>
    </span>
  );
}

/**
 * The sample of a theme. The system sample is light on the left and dark on the
 * right. The split is at the center, in the gap between the two notes. Thus,
 * each half shows one full note, and the line cuts nothing but the bar. A split
 * from corner to corner cut both notes into pieces.
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
            mode === "system" ? { clipPath: "inset(0 0 0 50%)" } : undefined
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
    <div class="flex flex-col items-center gap-1.5" data-setting-row>
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
 * The swatch of one shade: the surface of the light theme, or the 700 step of
 * the dark theme, the tone with which it outlines its cards. That step is light
 * enough to carry a hue, and dark enough that Midnight and Black look dimmer
 * than Neutral. An inline block, so that its size applies in any parent, not
 * only in the flex row of the select.
 */
function ShadeSwatch({
  theme,
  tint,
  class: className = swatchClass,
}: {
  theme: "light" | "dark";
  tint: Tint;
  class?: string | undefined;
}) {
  return (
    <span
      class={`inline-block ${theme === "light" ? "light-ramp bg-white" : "dark-ramp bg-neutral-700"} ${className}`}
      style={tintProperties(theme, tint)}
    />
  );
}

/**
 * The color of a custom shade, as the round custom swatch of the board colors.
 * Its fill is the shade that the color makes, not the picked color. Only its
 * hue, its chroma to a limit, and how dark it is, count
 * (`utils/themeShades.ts`).
 */
function CustomShadeField({
  theme,
  label,
  value,
  tint,
  onInput,
}: {
  theme: "light" | "dark";
  label: string;
  value: string;
  tint: Tint;
  onInput: (hex: string) => void;
}) {
  return (
    <CustomColorSwatch label={label} value={value} onInput={onInput}>
      <ShadeSwatch
        theme={theme}
        tint={tint}
        class="w-full h-full rounded-full"
      />
    </CustomColorSwatch>
  );
}

/**
 * The name of a light shade. A vivid shade has the name of the note color of
 * its hue, and a pale shade is a light one of it. The stored values stay
 * `red` (pale) and `vivid-red`, because a release before the vivid shades
 * stored `red` for the pale one.
 */
function lightHueLabel(hue: LightHue): string {
  const color = shadeColor(hue);
  if (color === null)
    return t(`settings.lightHue.${hue as "white" | "custom"}`);
  return hue.startsWith("vivid-")
    ? t(`color.${color}`)
    : t("settings.lightHue.pale", { color: t(`color.${color}`) });
}

function darkHueLabel(hue: DarkHue): string {
  const color = shadeColor(hue);
  return color === null
    ? t(`settings.darkHue.${hue as Exclude<DarkHue, ShadeColor>}`)
    : t(`color.${color}`);
}

/**
 * The theme as a sample of each, with the light and dark shades under the light
 * and dark samples, which use them. You can select either shade whatever the
 * current theme, ready for when the other theme is on. A custom shade shows its
 * color field under its select.
 */
export function ThemePicker() {
  const lightHueOptions: SettingsOption<LightHue>[] = LIGHT_HUES.map((hue) => ({
    value: hue,
    label: lightHueLabel(hue),
    preview: (
      <ShadeSwatch
        theme="light"
        tint={lightTint(hue, lightCustomColor.value)}
      />
    ),
  }));
  const darkHueOptions: SettingsOption<DarkHue>[] = DARK_HUES.map((hue) => ({
    value: hue,
    label: darkHueLabel(hue),
    preview: (
      <ShadeSwatch theme="dark" tint={darkTint(hue, darkCustomColor.value)} />
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
      <div class={`${columnsClass} items-start`}>
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
          {lightHue.value === "custom" && (
            <CustomShadeField
              theme="light"
              label={t("settings.lightHue.customColor")}
              value={lightCustomColor.value}
              tint={appliedLightTint.value}
              onInput={(hex) => {
                lightCustomColor.value = hex;
              }}
            />
          )}
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
          {darkHue.value === "custom" && (
            <CustomShadeField
              theme="dark"
              label={t("settings.darkHue.customColor")}
              value={darkCustomColor.value}
              tint={appliedDarkTint.value}
              onInput={(hex) => {
                darkCustomColor.value = hex;
              }}
            />
          )}
        </ShadeColumn>
      </div>
    </div>
  );
}
