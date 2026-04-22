import { NoteFont } from "@manifesto/shared";
import { effect, signal } from "@preact/signals";
import { detectBrowserLocale } from "../i18n/detect.js";
import { isLocale, type Locale } from "../i18n/locales.js";

// --- Types ---

export type ViewMode = "grid" | "list";
export type NoteSize = "fit" | "square";
export type SortMode = "default" | "updated" | "created";
export type ThemeMode = "system" | "light" | "dark";
export type DefaultNoteColor = "plain" | "random";
export type DefaultNoteFont = NoteFont | "random";
export type DecimalSeparator = "auto" | "." | ",";

const DECIMAL_SEPARATOR_VALUES: readonly DecimalSeparator[] = [
  "auto",
  ".",
  ",",
];

function parseDecimalSeparator(value: unknown): DecimalSeparator {
  return typeof value === "string" &&
    (DECIMAL_SEPARATOR_VALUES as readonly string[]).includes(value)
    ? (value as DecimalSeparator)
    : "auto";
}

// --- Persisted preferences ---

const PREFS_KEY = "manifesto:prefs";

export interface LoadedPrefs {
  viewMode: ViewMode;
  sortMode: SortMode;
  noteSize: NoteSize;
  theme: ThemeMode;
  defaultNoteColor: DefaultNoteColor;
  defaultNoteFont: DefaultNoteFont;
  locale: Locale;
  inlineCalculations: boolean;
  decimalSeparator: DecimalSeparator;
}

export function parsePrefs(raw: string | null): LoadedPrefs {
  let persistedLocale: Locale | undefined;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isLocale(parsed.locale)) persistedLocale = parsed.locale;
      return {
        viewMode: parsed.viewMode ?? "grid",
        sortMode: parsed.sortMode ?? "default",
        noteSize: parsed.noteSize ?? "fit",
        theme: parsed.theme ?? "system",
        defaultNoteColor: parsed.defaultNoteColor ?? "plain",
        defaultNoteFont:
          parsed.defaultNoteFont ?? parsed.noteFont ?? NoteFont.Default,
        locale: persistedLocale ?? detectBrowserLocale(),
        inlineCalculations:
          typeof parsed.inlineCalculations === "boolean"
            ? parsed.inlineCalculations
            : true,
        decimalSeparator: parseDecimalSeparator(parsed.decimalSeparator),
      };
    } catch {
      // ignore
    }
  }
  return {
    viewMode: "grid",
    sortMode: "default",
    noteSize: "fit",
    theme: "system",
    defaultNoteColor: "plain",
    defaultNoteFont: NoteFont.Default,
    locale: detectBrowserLocale(),
    inlineCalculations: true,
    decimalSeparator: "auto",
  };
}

function loadPrefs(): LoadedPrefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return parsePrefs(null);
  }
}

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      viewMode: viewMode.value,
      sortMode: sortMode.value,
      noteSize: noteSize.value,
      theme: theme.value,
      defaultNoteColor: defaultNoteColor.value,
      defaultNoteFont: defaultNoteFont.value,
      locale: locale.value,
      inlineCalculations: inlineCalculations.value,
      decimalSeparator: decimalSeparator.value,
    }),
  );
}

const prefs = loadPrefs();

export const viewMode = signal<ViewMode>(prefs.viewMode);
export const noteSize = signal<NoteSize>(prefs.noteSize);
export const sortMode = signal<SortMode>(prefs.sortMode);
export const theme = signal<ThemeMode>(prefs.theme);
export const defaultNoteColor = signal<DefaultNoteColor>(
  prefs.defaultNoteColor,
);
export const defaultNoteFont = signal<DefaultNoteFont>(prefs.defaultNoteFont);
export const locale = signal<Locale>(prefs.locale);
export const inlineCalculations = signal<boolean>(prefs.inlineCalculations);
export const decimalSeparator = signal<DecimalSeparator>(
  prefs.decimalSeparator,
);

/** Returns the concrete decimal separator, resolving "auto" via current locale. */
export function resolvedDecimalSeparator(): "." | "," {
  if (decimalSeparator.value !== "auto") return decimalSeparator.value;
  return locale.value === "fi" ? "," : ".";
}

// Persist preferences when any pref signal changes (debounced)
let saveTimeout: ReturnType<typeof setTimeout> | undefined;
effect(() => {
  // Read all signals to establish dependencies
  viewMode.value;
  sortMode.value;
  noteSize.value;
  theme.value;
  defaultNoteColor.value;
  defaultNoteFont.value;
  locale.value;
  inlineCalculations.value;
  decimalSeparator.value;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(savePrefs, 50);
});

// --- Theme ---

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

effect(() => applyTheme(theme.value));

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (theme.value === "system") applyTheme("system");
  });
