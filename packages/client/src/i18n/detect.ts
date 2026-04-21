import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "./locales.js";

/**
 * Pick the first supported locale from the browser's language preferences.
 * Accepts region-tagged variants (e.g. `fi-FI`) by matching on the base tag.
 */
export function detectBrowserLocale(candidates?: readonly string[]): Locale {
  const langs =
    candidates ??
    (typeof navigator !== "undefined"
      ? navigator.languages?.length
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : []
      : []);
  for (const lang of langs) {
    const base = lang.split(/[-_]/)[0].toLowerCase();
    if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
      return base as Locale;
    }
  }
  return DEFAULT_LOCALE;
}
