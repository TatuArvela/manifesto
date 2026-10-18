import { detectBrowserLocale } from "#/i18n/detect.ts";
import { t } from "#/i18n/index.ts";
import { type Locale, SUPPORTED_LOCALES } from "#/i18n/locales.ts";
import { locale } from "#/state/prefs.ts";
import {
  SettingsGroup,
  type SettingsOption,
  SettingsRow,
  SettingsSelect,
} from "./SettingsControls.tsx";

// Endonyms never translate: each language's name is rendered in that language.
const LOCALE_ENDONYMS: Record<string, string> = {
  en: "English",
  fi: "Suomi",
};

type LanguageOption = "system" | (typeof SUPPORTED_LOCALES)[number];

/** The language the app is shown in, on a page of its own. */
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
    </SettingsGroup>
  );
}
