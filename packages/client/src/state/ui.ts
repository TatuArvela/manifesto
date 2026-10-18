import type { NoteColor } from "@manifesto/shared";
import { effect, signal } from "@preact/signals";

export type AppView =
  | "active"
  | "tags"
  | "reminders"
  | "autoNotes"
  | "archived"
  | "trash"
  | "search"
  | "admin";

export type SearchType = "reminders" | "checklists" | "images" | "urls";
export type SearchLocation = "active" | "archived" | "trashed";

export const activeView = signal<AppView>("active");
export const activeTag = signal<string | null>(null);
export const tagsShowActive = signal(true);
export const tagsShowArchived = signal(false);
export const tagsShowTrashed = signal(false);
export const selectMode = signal(false);
export const selectedNotes = signal<Set<string>>(new Set());
export const editingNoteId = signal<string | null>(null);
export const showSettings = signal(false);
/** The settings modal's pages; the account ones exist only when signed in. */
export type SettingsTab =
  | "account"
  | "twoFactor"
  | "keys"
  | "tokens"
  | "webhooks"
  | "activity"
  | "language"
  | "appearance"
  | "board"
  | "features"
  | "data"
  | "clip"
  | "about";
/** The page the settings modal shows, kept between openings. */
export const settingsTab = signal<SettingsTab>("appearance");

export function openSettings(tab?: SettingsTab) {
  if (tab) settingsTab.value = tab;
  showSettings.value = true;
}
export const showWelcome = signal(false);
/** The keyboard shortcut sheet (`?`). */
export const showShortcuts = signal(false);
/** Asks `NoteInput` to open a new note, as the `c` shortcut does. */
export const newNoteRequested = signal(false);
/** The query the notes are filtered by; trails `searchInput` while typing. */
export const searchQuery = signal("");
/** What the search field shows, which changes on every keystroke. */
export const searchInput = signal("");
export const searchTypes = signal<Set<SearchType>>(new Set());
export const searchColors = signal<Set<NoteColor>>(new Set());
export const searchLocations = signal<Set<SearchLocation>>(new Set(["active"]));

/**
 * The view the user was on before entering `/search`. Used by the close button
 * in the search header to return them to where they came from.
 */
export const previousView = signal<AppView>("active");

export function toggleSearchType(type: SearchType) {
  const next = new Set(searchTypes.value);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  searchTypes.value = next;
}

export function toggleSearchColor(color: NoteColor) {
  const next = new Set(searchColors.value);
  if (next.has(color)) next.delete(color);
  else next.add(color);
  searchColors.value = next;
}

export function toggleSearchLocation(location: SearchLocation) {
  const next = new Set(searchLocations.value);
  if (next.has(location)) next.delete(location);
  else next.add(location);
  searchLocations.value = next;
}

/**
 * How long typing must pause before the notes are filtered again. Filtering
 * scans every note's text and re-lays the whole grid, which on a big board
 * made each keystroke visibly lag behind the field.
 */
export const SEARCH_DEBOUNCE_MS = 200;

let searchTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Takes a keystroke in a search field. The field follows at once, the results
 * once typing pauses, except that emptying the field clears them at once:
 * there is nothing to wait for, and the board coming back should not lag.
 */
export function typeSearch(value: string) {
  searchInput.value = value;
  clearTimeout(searchTimer);
  if (value === "") {
    searchQuery.value = "";
    return;
  }
  searchTimer = setTimeout(() => {
    searchQuery.value = value;
  }, SEARCH_DEBOUNCE_MS);
}

export function clearSearchFilters() {
  clearTimeout(searchTimer);
  searchInput.value = "";
  searchQuery.value = "";
  searchTypes.value = new Set();
  searchColors.value = new Set();
  searchLocations.value = new Set(["active"]);
}

/**
 * Leave the search view: drop the filters and return the user to wherever
 * they came from. `previousView` can itself be "search" when search was the
 * entry point (a reload or deep link on /search), so fall back to "active".
 */
export function exitSearch() {
  clearSearchFilters();
  activeView.value =
    previousView.value === "search" ? "active" : previousView.value;
}

// Track `previousView` so the search close button can return to where the
// user came from. Updates whenever the active view changes to a non-search view.
effect(() => {
  const view = activeView.value;
  if (view !== "search") previousView.value = view;
});

/**
 * What the board last said to a screen reader that it shows no other way,
 * such as where a card moved to from the keyboard. `NoteGrid` keeps it in a
 * polite live region.
 */
export const boardAnnouncement = signal("");

// --- Notifications ---

export type ToastType = "error" | "success";

export interface AppToast {
  id: number;
  type: ToastType;
  message: string;
}

let nextToastId = 0;

export const toasts = signal<AppToast[]>([]);

export function showError(message: string) {
  showToast("error", message);
}

export function showSuccess(message: string) {
  showToast("success", message);
}

/** How long a success stays up, counted while the stack is not held. */
export const SUCCESS_TOAST_MS = 5000;
/** The most toasts on screen at once; the oldest goes when another comes. */
export const MAX_TOASTS = 5;

/** Successes whose time ran out while the stack was held. */
const expired = new Set<number>();
let held = false;

function expireLater(id: number) {
  setTimeout(() => {
    if (held) expired.add(id);
    else dismissToast(id);
  }, SUCCESS_TOAST_MS);
}

/**
 * An error stays until it is dismissed: it is what someone has to act on,
 * and one that left after five seconds was gone before a slow reader, or a
 * screen reader still speaking, had finished with it. A success leaves by
 * itself, but not while the stack is held (`holdToasts`).
 */
function showToast(type: ToastType, message: string) {
  const id = nextToastId++;
  toasts.value = [...toasts.value, { id, type, message }].slice(-MAX_TOASTS);
  if (type === "success") expireLater(id);
}

/**
 * Held while the pointer or keyboard focus is on the stack, so a toast does
 * not leave from under the person reading or dismissing it. Those whose time
 * ran out meanwhile get a fresh one on release.
 */
export function holdToasts(hold: boolean) {
  held = hold;
  if (hold) return;
  for (const id of expired) expireLater(id);
  expired.clear();
}

export function dismissToast(id: number) {
  expired.delete(id);
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
