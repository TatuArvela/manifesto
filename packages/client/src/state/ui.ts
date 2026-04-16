import { signal } from "@preact/signals";

export type AppView = "active" | "tags" | "archived" | "trash";

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

// --- Error notifications ---

export interface AppError {
  id: number;
  message: string;
}

let nextErrorId = 0;

export const errors = signal<AppError[]>([]);

export function showError(message: string) {
  const id = nextErrorId++;
  errors.value = [...errors.value, { id, message }];
  setTimeout(() => dismissError(id), 5000);
}

export function dismissError(id: number) {
  errors.value = errors.value.filter((e) => e.id !== id);
}
