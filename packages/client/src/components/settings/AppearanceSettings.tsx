import { Monitor, Moon, Sun } from "lucide-preact";
import { detectBrowserLocale } from "../../i18n/detect.js";
import { t } from "../../i18n/index.js";
import { type Locale, SUPPORTED_LOCALES } from "../../i18n/locales.js";
import {
  animations,
  DARK_HUES,
  type DarkHue,
  darkHue,
  locale,
  noteCorners,
  noteQuips,
  stickyTopBar,
  type ThemeMode,
  theme,
} from "../../state/index.js";
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

export function AppearanceSettings() {
  const hueOptions: SettingsOption<DarkHue>[] = DARK_HUES.map((hue) => ({
    value: hue,
    label: t(`settings.darkHue.${hue}`),
    preview: (
      <span
        data-dark-hue={hue}
        class="dark-hue-swatch w-9 h-5 shrink-0 rounded ring-1 ring-inset ring-black/10 dark:ring-white/15"
      />
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

        <SettingsRow label={t("settings.darkHue")}>
          <SettingsSelect
            label={t("settings.darkHue")}
            value={darkHue.value}
            options={hueOptions}
            onChange={(next) => {
              darkHue.value = next;
            }}
          />
        </SettingsRow>
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
