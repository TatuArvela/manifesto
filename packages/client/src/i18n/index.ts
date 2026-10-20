import { NoteColor, NoteFont } from "@manifesto/shared";
import { effect, signal } from "@preact/signals";
import { colorPickerSwatches } from "#/colors.ts";
import { APP_NAME } from "#/config.ts";
import type { DefaultNoteFont } from "#/state/prefs.ts";
import { locale } from "#/state/prefs.ts";
import { DEFAULT_LOCALE, type Locale } from "./locales.ts";
import {
  catalogues,
  loadCatalogue,
  type MessageKey,
  type PluralEntry,
} from "./messages/index.ts";

export { detectBrowserLocale } from "./detect.ts";
export {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  SUPPORTED_LOCALES,
} from "./locales.ts";
export { loadCatalogue, type MessageKey } from "./messages/index.ts";

type Vars = Record<string, string | number>;

/**
 * The language on the screen: the selected `locale` after its catalogue is
 * here, and until then the previous language. Thus, a change never shows
 * English for a moment. `main.tsx` loads the catalogue of the saved choice
 * before the first render. Thus, a page opens in its language from the start.
 * All code below reads this, not `locale`. Thus, strings, dates and numbers
 * change together.
 */
const shown = signal<Locale>(DEFAULT_LOCALE);

effect(() => {
  const wanted = locale.value;
  if (catalogues[wanted]) {
    shown.value = wanted;
    return;
  }
  void loadCatalogue(wanted).then((ok) => {
    if (ok && locale.peek() === wanted) shown.value = wanted;
  });
});

function interpolate(template: string, vars?: Vars): string {
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (vars && name in vars) return String(vars[name]);
    // `{appName}` comes from the build-time branding, not from the message
    // catalogue. Thus, translations never contain the product name.
    if (name === "appName") return APP_NAME;
    return match;
  });
}

function lookupRaw(loc: Locale, key: MessageKey): unknown {
  return (catalogues[loc] as Record<string, unknown> | undefined)?.[key];
}

function resolveString(key: MessageKey): string {
  // Read the signal, so that callers that use t() from render bodies subscribe.
  const active = shown.value;
  let raw = lookupRaw(active, key);
  if (typeof raw !== "string") {
    if (active !== DEFAULT_LOCALE) {
      raw = lookupRaw(DEFAULT_LOCALE, key);
    }
  }
  if (typeof raw !== "string") {
    if (import.meta.env?.DEV) {
      console.warn(`[i18n] missing string for key: ${String(key)}`);
    }
    return String(key);
  }
  return raw;
}

function resolvePlural(key: MessageKey, n: number): string {
  const active = shown.value;
  let raw = lookupRaw(active, key) as PluralEntry | string | undefined;
  if (!raw || typeof raw === "string") {
    if (active !== DEFAULT_LOCALE) {
      raw = lookupRaw(DEFAULT_LOCALE, key) as PluralEntry | string | undefined;
    }
  }
  if (!raw || typeof raw === "string") {
    if (import.meta.env?.DEV) {
      console.warn(`[i18n] missing plural entry for key: ${String(key)}`);
    }
    return typeof raw === "string" ? raw : String(key);
  }
  const tag = new Intl.PluralRules(active).select(n);
  return raw[tag as keyof PluralEntry] ?? raw.other;
}

/**
 * Translate a key for the current locale. It reads the language on the screen.
 * Thus, each call subscribes during render. **Always call it inside component
 * render bodies**, not at module scope. If not, the string stays in the locale
 * from load time.
 *
 * `{appName}` resolves by itself. All other placeholders come from `vars`.
 */
export function t(key: MessageKey, vars?: Vars): string {
  return interpolate(resolveString(key), vars);
}

/**
 * Translate a plural key. `{count}` is `n` by default, and `vars` can override
 * it. The same reactivity rule as for `t()`.
 */
export function plural(key: MessageKey, n: number, vars?: Vars): string {
  return interpolate(resolvePlural(key, n), { count: n, ...(vars ?? {}) });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(shown.value, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(shown.value, {
    dateStyle: "medium",
  });
}

/**
 * Names joined as the language joins them ("Alice, Bob and Carol", "Alice, Bob
 * ja Carol"). Thus, no message has to contain a separator. It reads the
 * language on the screen. Thus, the same render-body rule as for `t()` applies.
 */
export function formatList(items: string[]): string {
  return new Intl.ListFormat(shown.value, { type: "conjunction" }).format(
    items,
  );
}

/**
 * Format a byte count to show in megabytes.
 *
 * Both halves come from the platform, not from each message: the decimal
 * separator (`1.5` / `1,5`) and the unit abbreviation, which CLDR gives as "MB"
 * in English and "Mt" in Finnish. A message that contained the unit would need
 * each translator to know the local convention, and would silently become
 * incorrect when the limit changed.
 *
 * Divides by 1024². Windows and most file managers label sizes in this way, and
 * `MAX_IMAGE_SOURCE_BYTES` (now the only value shown here) is defined in this
 * way. It reads the language on the screen. Thus, the same render-body rule as
 * for `t()` applies.
 */
export function formatFileSize(bytes: number): string {
  return new Intl.NumberFormat(shown.value, {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / (1024 * 1024));
}

/**
 * A whole percentage, as the language writes it ("10%", "10 %"). It reads the
 * language on the screen. Thus, the same render-body rule as for `t()` applies.
 */
export function formatPercent(percent: number): string {
  return new Intl.NumberFormat(shown.value, { style: "percent" }).format(
    percent / 100,
  );
}

export function getFontLabel(font: DefaultNoteFont): string {
  switch (font) {
    case NoteFont.Default:
      return t("font.sansSerif");
    case NoteFont.Serif:
      return t("font.serif");
    case NoteFont.Monospace:
      return t("font.monospace");
    case NoteFont.PermanentMarker:
      return t("font.marker");
    case NoteFont.ComicRelief:
      return t("font.comic");
    case NoteFont.RougeScript:
      return t("font.script");
    case "random":
      return t("font.random");
  }
}

const COLOR_LABEL_KEY: Record<NoteColor, MessageKey> = {
  [NoteColor.Default]: "color.default",
  [NoteColor.Red]: "color.red",
  [NoteColor.Orange]: "color.orange",
  [NoteColor.Yellow]: "color.yellow",
  [NoteColor.Green]: "color.green",
  [NoteColor.Teal]: "color.teal",
  [NoteColor.Blue]: "color.blue",
  [NoteColor.Purple]: "color.purple",
  [NoteColor.Pink]: "color.pink",
  [NoteColor.Brown]: "color.brown",
  [NoteColor.Gray]: "color.gray",
};

export function getColorLabel(color: NoteColor): string {
  return t(COLOR_LABEL_KEY[color]);
}

export function getColorPickerColors(): {
  value: NoteColor;
  label: string;
  swatch: string;
}[] {
  return colorPickerSwatches.map((c) => ({
    value: c.value,
    label: getColorLabel(c.value),
    swatch: c.swatch,
  }));
}

// Keep <html lang> the same as the language on the screen.
if (typeof document !== "undefined") {
  effect(() => {
    document.documentElement.lang = shown.value;
  });
}
