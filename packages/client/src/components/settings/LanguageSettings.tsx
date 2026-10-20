import { ThreeWayToggle } from "#/components/ToggleSwitch.tsx";
import { detectBrowserLocale } from "#/i18n/detect.ts";
import { t } from "#/i18n/index.ts";
import { type Locale, SUPPORTED_LOCALES } from "#/i18n/locales.ts";
import {
  type DecimalSeparator,
  decimalSeparator,
  locale,
} from "#/state/prefs.ts";
import {
  SettingsGroup,
  type SettingsOption,
  SettingsRow,
  SettingsSelect,
  toggleTrackClass,
} from "./SettingsControls.tsx";

// Endonyms never translate: the name of each language is in that language.
const LOCALE_ENDONYMS: Record<string, string> = {
  en: "English",
  fi: "Suomi",
};

type LanguageOption = "system" | (typeof SUPPORTED_LOCALES)[number];

const decimalSeparators: DecimalSeparator[] = ["auto", ".", ","];

/**
 * Language and Region: the language of the app, and the decimal separator that
 * inline calculations read and write, which follows it on Auto.
 */
export function LanguageSettings() {
  const languageOptions: SettingsOption<LanguageOption>[] = [
    { value: "system", label: t("settings.language.system") },
    ...SUPPORTED_LOCALES.map((l) => ({
      value: l as LanguageOption,
      label: LOCALE_ENDONYMS[l] ?? l,
    })),
  ];
  return (
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

      <SettingsRow label={t("settings.decimalSeparator")}>
        <ThreeWayToggle
          trackClass={toggleTrackClass}
          value={decimalSeparators.indexOf(decimalSeparator.value)}
          onChange={(i) => {
            decimalSeparator.value =
              decimalSeparators[i] ?? decimalSeparator.value;
          }}
          options={[
            {
              icon: <span class="text-xs font-semibold">A</span>,
              label: t("settings.decimalSeparator.auto"),
            },
            {
              icon: <span class="text-base leading-none">.</span>,
              label: t("settings.decimalSeparator.dot"),
            },
            {
              icon: <span class="text-base leading-none">,</span>,
              label: t("settings.decimalSeparator.comma"),
            },
          ]}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
