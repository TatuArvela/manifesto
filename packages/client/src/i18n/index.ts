import { NoteColor, NoteFont } from "@manifesto/shared";
import { effect } from "@preact/signals";
import { colorPickerSwatches } from "../colors.js";
import type { DefaultNoteFont } from "../state/prefs.js";
import { locale } from "../state/prefs.js";
import { DEFAULT_LOCALE, type Locale } from "./locales.js";
import {
  type MessageKey,
  messages,
  type PluralEntry,
} from "./messages/index.js";

export { detectBrowserLocale } from "./detect.js";
export {
  DEFAULT_LOCALE,
  isLocale,
  type Locale,
  SUPPORTED_LOCALES,
} from "./locales.js";
export type { MessageKey } from "./messages/index.js";

type Vars = Record<string, string | number>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match,
  );
}

function lookupRaw(loc: Locale, key: MessageKey): unknown {
  return (messages[loc] as Record<string, unknown>)[key];
}

function resolveString(key: MessageKey): string {
  // Read the signal so callers using t() from render bodies subscribe.
  const active = locale.value;
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
  const active = locale.value;
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
 * Translate a key for the current locale. Reads `locale.value` internally, so
 * every call subscribes during render. **Always call inside component render
 * bodies** — not at module scope, or the string will freeze to the load-time
 * locale.
 */
export function t(key: MessageKey, vars?: Vars): string {
  return interpolate(resolveString(key), vars);
}

/**
 * Translate a plural key. `{count}` defaults to `n` and may be overridden
 * via `vars`. Same reactivity rule as `t()`.
 */
export function plural(key: MessageKey, n: number, vars?: Vars): string {
  return interpolate(resolvePlural(key, n), { count: n, ...(vars ?? {}) });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(locale.value, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale.value, {
    dateStyle: "medium",
  });
}

export function getFontLabel(font: DefaultNoteFont): string {
  switch (font) {
    case NoteFont.Default:
      return t("font.default");
    case NoteFont.PermanentMarker:
      return t("font.permanentMarker");
    case NoteFont.ComicRelief:
      return t("font.comicRelief");
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

// Keep <html lang> in sync with the active locale.
if (typeof document !== "undefined") {
  effect(() => {
    document.documentElement.lang = locale.value;
  });
}
