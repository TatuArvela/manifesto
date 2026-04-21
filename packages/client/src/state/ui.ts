import { signal } from "@preact/signals";

export type AppView = "active" | "tags" | "reminders" | "archived" | "trash";

export const activeView = signal<AppView>("active");
export const activeTag = signal<string | null>(null);
export const tagsShowArchived = signal(false);
export const tagsShowTrashed = signal(false);
export const selectMode = signal(false);
export const selectedNotes = signal<Set<string>>(new Set());
export const editingNoteId = signal<string | null>(null);
export const mobileSidebarOpen = signal(false);
export const showSettings = signal(false);
export const searchQuery = signal("");

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
