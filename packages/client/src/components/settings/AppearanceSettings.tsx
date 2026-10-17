import { Monitor, Moon, Sun } from "lucide-preact";
import { detectBrowserLocale } from "../../i18n/detect.js";
import { t } from "../../i18n/index.js";
import { type Locale, SUPPORTED_LOCALES } from "../../i18n/locales.js";
import {
  animations,
  BOARD_COLORS,
  type BoardColor,
  DARK_HUES,
  type DarkHue,
  darkHue,
  LIGHT_HUES,
  type LightHue,
  lightHue,
  locale,
  noteCorners,
  noteQuips,
  stickyTopBar,
  type ThemeMode,
  theme,
} from "../../state/prefs.js";
import { Switch, ThreeWayToggle } from "../ToggleSwitch.js";
import { BoardBackgroundSetting } from "./BoardBackgroundSetting.js";
import {
  SettingsGroup,
  type SettingsOption,
  SettingsRow,
  SettingsSelect,
  toggleTrackClass,
} from "./SettingsControls.js";

const themeModes: ThemeMode[] = ["system", "light", "dark"];

// Endonyms never translate: each language's name is rendered in that language.
const LOCALE_ENDONYMS: Record<string, string> = {
  en: "English",
  fi: "Suomi",
};

type LanguageOption = "system" | (typeof SUPPORTED_LOCALES)[number];

const swatchClass =
  "w-9 h-5 shrink-0 rounded ring-1 ring-inset ring-black/10 dark:ring-white/15";

function isBoardColor(hue: string): hue is BoardColor {
  return (BOARD_COLORS as readonly string[]).includes(hue);
}

export function AppearanceSettings() {
  const lightHueOptions: SettingsOption<LightHue>[] = LIGHT_HUES.map((hue) => ({
    value: hue,
    // The preset colours share their names with the note colours.
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

  const languageOptions: SettingsOption<LanguageOption>[] = [
    { value: "system", label: t("settings.language.system") },
    ...SUPPORTED_LOCALES.map((l) => ({
      value: l as LanguageOption,
      label: LOCALE_ENDONYMS[l] ?? l,
    })),
  ];
  return (
    <div class="space-y-6">
      <SettingsGroup>
        <SettingsRow label={t("settings.language")}>
          <SettingsSelect
            label={t("settings.language")}
            value={locale.value as LanguageOption}
            options={languageOptions}
            onChange={(next) => {
              locale.value =
                next === "system" ? detectBrowserLocale() : (next as Locale);
            }}
          />
        </SettingsRow>

        {/* The theme and its two shades read as one setting, so no line
            parts them. Each shade is dimmed while the theme is pinned to the
            other one, since it would change nothing on screen. */}
        <div>
          <SettingsRow label={t("settings.theme")}>
            <ThreeWayToggle
              trackClass={toggleTrackClass}
              value={themeModes.indexOf(theme.value)}
              onChange={(i) => {
                theme.value = themeModes[i] ?? theme.value;
              }}
              options={[
                {
                  icon: <Monitor class="w-4 h-4" />,
                  label: t("settings.theme.system"),
                },
                {
                  icon: <Sun class="w-4 h-4" />,
                  label: t("settings.theme.light"),
                },
                {
                  icon: <Moon class="w-4 h-4" />,
                  label: t("settings.theme.dark"),
                },
              ]}
            />
          </SettingsRow>

          <SettingsRow label={t("settings.lightHue")}>
            <SettingsSelect
              label={t("settings.lightHue")}
              value={lightHue.value}
              options={lightHueOptions}
              disabled={theme.value === "dark"}
              onChange={(next) => {
                lightHue.value = next;
              }}
            />
          </SettingsRow>

          <SettingsRow label={t("settings.darkHue")}>
            <SettingsSelect
              label={t("settings.darkHue")}
              value={darkHue.value}
              options={darkHueOptions}
              disabled={theme.value === "light"}
              onChange={(next) => {
                darkHue.value = next;
              }}
            />
          </SettingsRow>
        </div>

        <SettingsRow label={t("settings.noteCorners")}>
          <Switch
            checked={noteCorners.value === "rounded"}
            onChange={(checked) => {
              noteCorners.value = checked ? "rounded" : "straight";
            }}
            label={t("settings.noteCorners")}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.boardBackground")}>
        <BoardBackgroundSetting />
      </SettingsGroup>

      <SettingsGroup title={t("settings.group.behavior")}>
        <SettingsRow label={t("settings.stickyTopBar")}>
          <Switch
            checked={stickyTopBar.value}
            onChange={(checked) => {
              stickyTopBar.value = checked;
            }}
            label={t("settings.stickyTopBar")}
          />
        </SettingsRow>

        <SettingsRow label={t("settings.animations")}>
          <Switch
            checked={animations.value}
            onChange={(checked) => {
              animations.value = checked;
            }}
            label={t("settings.animations")}
          />
        </SettingsRow>

        <SettingsRow label={t("settings.noteQuips")}>
          <Switch
            checked={noteQuips.value}
            onChange={(checked) => {
              noteQuips.value = checked;
            }}
            label={t("settings.noteQuips")}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
