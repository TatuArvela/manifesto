import type { NoteColor } from "@manifesto/shared";
import { effect, signal } from "@preact/signals";

export type AppView =
  | "active"
  | "tags"
  | "reminders"
  | "autoNotes"
  | "archived"
  | "trash"
  | "search";

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
export const searchQuery = signal("");
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

export function clearSearchFilters() {
  searchQuery.value = "";
  searchTypes.value = new Set();
  searchColors.value = new Set();
  searchLocations.value = new Set(["active"]);
}

// Track `previousView` so the search close button can return to where the
// user came from. Updates whenever the active view changes to a non-search view.
effect(() => {
  const view = activeView.value;
  if (view !== "search") previousView.value = view;
});

// --- Notifications ---

export type ToastType = "error" | "success";

export interface AppToast {
  id: number;
  type: ToastType;
  message: string;
}

let nextToastId = 0;

export const toasts = signal<AppToast[]>([]);

/** @deprecated Use `toasts` instead. */
export const errors = toasts;

export function showError(message: string) {
  showToast("error", message);
}

export function showSuccess(message: string) {
  showToast("success", message);
}

function showToast(type: ToastType, message: string) {
  const id = nextToastId++;
  toasts.value = [...toasts.value, { id, type, message }];
  setTimeout(() => dismissToast(id), 5000);
}

export function dismissToast(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/** @deprecated Use `dismissToast` instead. */
export const dismissError = dismissToast;
