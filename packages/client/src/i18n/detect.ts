import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "./locales.ts";

/**
 * Select the first supported locale from the language preferences of the
 * browser. Accepts variants with a region tag (for example `fi-FI`), by a match
 * on the base tag.
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
    const [base = ""] = lang.toLowerCase().split(/[-_]/);
    if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
      return base as Locale;
    }
  }
  return DEFAULT_LOCALE;
}
