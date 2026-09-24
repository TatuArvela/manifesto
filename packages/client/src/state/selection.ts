import { selectedNotes, selectMode } from "./ui.js";
import { sortedNotes } from "./views.js";

export function enterSelectMode(noteId?: string) {
  selectMode.value = true;
  selectedNotes.value = noteId ? new Set([noteId]) : new Set();
}

export function exitSelectMode() {
  selectMode.value = false;
  selectedNotes.value = new Set();
}

/** Selects every note on screen, or deselects them if all already are. */
export function selectAllVisible() {
  const ids = sortedNotes.value.filter((n) => !n.readonly).map((n) => n.id);
  const current = selectedNotes.value;
  const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
  const next = new Set(current);
  for (const id of ids) {
    if (allSelected) next.delete(id);
    else next.add(id);
  }
  selectedNotes.value = next;
  if (allSelected && next.size === 0) selectMode.value = false;
  if (!allSelected && next.size > 0) selectMode.value = true;
}

export function toggleSelectNote(id: string) {
  const next = new Set(selectedNotes.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedNotes.value = next;
  if (next.size === 0) {
    selectMode.value = false;
  }
}
