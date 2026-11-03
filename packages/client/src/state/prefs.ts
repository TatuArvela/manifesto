import { NoteColor, NoteFont } from "@manifesto/shared";
import { batch, effect, type Signal, signal, untracked } from "@preact/signals";
import {
  ACCOUNT_PREF_KEYS,
  type LoadedPrefs,
  PREF_KEYS,
  PREF_PARSERS,
  type PrefKey,
  parsePrefs,
  pickOne,
} from "./prefParsers.ts";
import { serverDefaultPrefs } from "./serverDefaults.ts";

export type {
  BoardColor,
  BoardColorChoice,
  BoardGradientChoice,
  BoardGradientDirection,
  BoardGradientDirectionChoice,
  BoardInk,
  BoardNeutral,
  BoardTexture,
  BoardTextureChoice,
  DarkHue,
  DecimalSeparator,
  DefaultNoteColor,
  DefaultNoteFont,
  EditMode,
  LightHue,
  LoadedPrefs,
  NoteCorners,
  NoteScale,
  NoteSize,
  SortMode,
  TagColor,
  ThemeMode,
  ViewMode,
} from "./prefParsers.ts";
export {
  ACCOUNT_PREF_KEYS,
  BOARD_COLORS,
  BOARD_GRADIENT_DIRECTIONS,
  BOARD_INKS,
  BOARD_NEUTRALS,
  BOARD_SPEED_STEP,
  BOARD_TEXTURES,
  DARK_HUES,
  DEFAULT_BOARD_CUSTOM_COLOR,
  LIGHT_HUES,
  MAX_BOARD_SPEED,
  MAX_TAG_COLORS,
  parsePrefs,
} from "./prefParsers.ts";

// --- Persisted preferences ---

const PREFS_KEY = "manifesto:prefs";

function loadPrefs(): LoadedPrefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY));
  } catch {
    return parsePrefs(null);
  }
}

/** If this browser had no preferences of its own when the page loaded. */
const freshDevice = (() => {
  try {
    return localStorage.getItem(PREFS_KEY) === null;
  } catch {
    return false;
  }
})();

const loaded = loadPrefs();
const prefSignals: Partial<Record<PrefKey, Signal<unknown>>> = {};

/** The signal for one preference, registered for save and adoption. */
function pref<K extends PrefKey>(key: K): Signal<LoadedPrefs[K]> {
  const s = signal(loaded[key]);
  prefSignals[key] = s as Signal<unknown>;
  return s;
}

export const viewMode = pref("viewMode");
export const noteSize = pref("noteSize");
export const noteScale = pref("noteScale");
export const sortMode = pref("sortMode");
export const theme = pref("theme");
export const defaultNoteColor = pref("defaultNoteColor");
export const defaultNoteFont = pref("defaultNoteFont");
export const locale = pref("locale");
export const inlineCalculations = pref("inlineCalculations");
export const decimalSeparator = pref("decimalSeparator");
export const noteCorners = pref("noteCorners");
export const noteTilt = pref("noteTilt");
export const complexShadows = pref("complexShadows");
export const noteFinish = pref("noteFinish");
export const animations = pref("animations");
export const lightHue = pref("lightHue");
export const darkHue = pref("darkHue");
export const noteQuips = pref("noteQuips");
export const formattingToolbar = pref("formattingToolbar");
export const checkedItemsLast = pref("checkedItemsLast");
export const checklistProgress = pref("checklistProgress");
export const linkPreviewCards = pref("linkPreviewCards");
export const openLinksInBrowser = pref("openLinksInBrowser");
export const stickyTopBar = pref("stickyTopBar");
export const hiddenTags = pref("hiddenTags");
export const tagColors = pref("tagColors");
export const confirmBeforeDelete = pref("confirmBeforeDelete");
export const defaultEditMode = pref("defaultEditMode");
export const boardColor = pref("boardColor");
export const boardCustomColor = pref("boardCustomColor");
export const boardGradient = pref("boardGradient");
export const boardGradientCustomColor = pref("boardGradientCustomColor");
export const boardGradientDirection = pref("boardGradientDirection");
export const boardGradientSpeed = pref("boardGradientSpeed");
export const boardTexture = pref("boardTexture");
export const boardTextureSpeed = pref("boardTextureSpeed");
export const boardInk = pref("boardInk");
export const boardInkColor = pref("boardInkColor");
export const boardTextureOpacity = pref("boardTextureOpacity");
export const boardUsePicture = pref("boardUsePicture");
export const boardImageStamp = pref("boardImageStamp");

for (const key of PREF_KEYS) {
  if (!prefSignals[key]) throw new Error(`Preference "${key}" has no signal`);
}

function prefSignal(key: PrefKey): Signal<unknown> {
  return prefSignals[key] as Signal<unknown>;
}

/**
 * Never throws. When storage refuses (a private window, a full quota), the
 * signals keep the preferences for this session.
 */
function savePrefs() {
  const blob: Record<string, unknown> = {};
  for (const key of PREF_KEYS) blob[key] = prefSignal(key).value;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(blob));
  } catch {
    // Kept only in memory.
  }
}

/**
 * Returns the concrete decimal separator. Resolves "auto" through the current
 * locale.
 */
export function resolvedDecimalSeparator(): "." | "," {
  if (decimalSeparator.value !== "auto") return decimalSeparator.value;
  return locale.value === "fi" ? "," : ".";
}

const RANDOM_NOTE_COLORS = Object.values(NoteColor).filter(
  (c) => c !== NoteColor.Default,
);
const RANDOM_NOTE_FONTS = Object.values(NoteFont).filter(
  (f) => f !== NoteFont.Default,
);

/** The color that a new note gets, with "random" resolved. */
export function pickDefaultColor(): NoteColor {
  const choice = defaultNoteColor.value;
  return choice === "random" ? pickOne(RANDOM_NOTE_COLORS) : choice;
}

/** The font that a new note gets, with "random" resolved. */
export function pickDefaultFont(): NoteFont {
  const choice = defaultNoteFont.value;
  return choice === "random" ? pickOne(RANDOM_NOTE_FONTS) : choice;
}

/**
 * True while the preferences of a different tab are applied. Each pref is
 * written back as one blob. Thus, a tab that adopts a remote change and then
 * saves would send the same content around again. Worse, a tab that never
 * adopted it would write its own stale copy over the change on the next
 * unrelated toggle. Change the theme in one tab, change the view mode in a
 * different tab, and the theme is back.
 */
let applyingRemotePrefs = false;

/**
 * If the preferences of the account come from the server (`prefsSync.ts`, while
 * signed in). Each tab then gets each change on its own socket. Thus, the code
 * takes the blob of a different tab only for the preferences of the device.
 * When the code took it fully, it put back a value that this tab had just
 * changed. The other tab saves each time it adopts the copy of the server, and
 * a late echo there of an earlier change carries the value from before.
 */
let accountPrefsFromServer = false;

export function setAccountPrefsFromServer(on: boolean): void {
  accountPrefsFromServer = on;
}

const DEVICE_PREF_KEYS = PREF_KEYS.filter(
  (key) => !ACCOUNT_PREF_KEYS.includes(key),
);

/** Adopts a preferences blob that a different tab wrote. */
function applyPrefs(next: LoadedPrefs) {
  const keys = accountPrefsFromServer ? DEVICE_PREF_KEYS : PREF_KEYS;
  applyingRemotePrefs = true;
  try {
    batch(() => {
      for (const key of keys) prefSignal(key).value = next[key];
    });
  } finally {
    applyingRemotePrefs = false;
  }
}

/**
 * If the change in progress came from a different place: a different tab, or
 * the preferences of the account on the server. `prefsSync.ts` sends neither
 * on.
 */
export function isApplyingRemotePrefs(): boolean {
  return applyingRemotePrefs;
}

/** Each preference as it is here, for an open-mode export. */
export function prefsSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of PREF_KEYS) snapshot[key] = prefSignal(key).value;
  return snapshot;
}

/** The preferences of the account as they are here, for the server. */
export function accountPrefsSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of ACCOUNT_PREF_KEYS) {
    snapshot[key] = prefSignal(key as PrefKey).value;
  }
  return snapshot;
}

/**
 * Adopts the preferences of the account from the server: each key that is
 * there, read by its parser as a manually edited blob would be, because a
 * different client wrote it. The code does not change a key that the server
 * does not have, or a key that belongs to this device. Saved here, because this
 * tab is the first to get it.
 */
export function adoptAccountPrefs(blob: Record<string, unknown>) {
  adoptPrefs(blob, ACCOUNT_PREF_KEYS as PrefKey[]);
}

/** Each of `keys` that `blob` contains, read by its parser, then saved. */
function adoptPrefs(blob: Record<string, unknown>, keys: readonly PrefKey[]) {
  applyingRemotePrefs = true;
  try {
    batch(() => {
      for (const key of keys) {
        if (!(key in blob)) continue;
        prefSignal(key).value = PREF_PARSERS[key](blob[key], blob);
      }
    });
  } finally {
    applyingRemotePrefs = false;
  }
  savePrefs();
}

// The defaults of the server, on a browser that had no preferences of its own
// when it loaded, with nobody signed in. Each key, also the keys of the device,
// at the same time. Thus, the sign-in screen of a first visit already looks as
// the host selected. One time. When signed in, the copy of the account decides
// (`prefsSync.ts`).
let defaultsApplied = false;
effect(() => {
  const defaults = serverDefaultPrefs.value;
  if (!defaults || defaults.signedIn || !freshDevice || defaultsApplied) {
    return;
  }
  defaultsApplied = true;
  untracked(() => adoptPrefs(defaults.prefs, PREF_KEYS));
});

// Persist preferences when a pref signal changes (debounced).
let saveTimeout: ReturnType<typeof setTimeout> | undefined;
effect(() => {
  // Read each signal unconditionally. The reads subscribe this.
  for (const key of PREF_KEYS) prefSignal(key).value;
  if (applyingRemotePrefs) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(savePrefs, 50);
});

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== PREFS_KEY) return;
    applyPrefs(parsePrefs(event.newValue ?? localStorage.getItem(PREFS_KEY)));
  });
}

// --- Note corners ---

// Exposed as a class on <html>, not given to each note surface as a prop. The
// note card, the create-note stack and the editor all read the same
// `--note-radius` from CSS.
effect(() => {
  document.documentElement.classList.toggle(
    "notes-rounded",
    noteCorners.value === "rounded",
  );
});

// --- Note tilt ---

// Also a class on <html>. Each card carries its own angle as `--note-tilt`,
// whatever the setting, and the stylesheet applies it only on a messy board.
effect(() => {
  document.documentElement.classList.toggle(
    "notes-messy",
    noteTilt.value === "messy",
  );
});

// --- Note finish ---

// An attribute on <html>, absent for matte. Each card carries `note-finish`,
// whatever the setting, and the stylesheet gives it the finish of the board
// (note-cards.css).
effect(() => {
  const root = document.documentElement;
  if (noteFinish.value === "matte") delete root.dataset.noteFinish;
  else root.dataset.noteFinish = noteFinish.value;
});

// --- Motion ---

effect(() => {
  document.documentElement.classList.toggle("no-motion", !animations.value);
});
