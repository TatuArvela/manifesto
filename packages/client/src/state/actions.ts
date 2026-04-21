import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { computed, signal } from "@preact/signals";
import { t } from "../i18n/index.js";
import { createStorage } from "../storage/index.js";
import { deleteVersions } from "../storage/VersionStorage.js";
import { defaultNoteColor, defaultNoteFont, sortMode } from "./prefs.js";
import {
  activeTag,
  activeView,
  editingNoteId,
  searchQuery,
  selectedNotes,
  selectMode,
  showError,
  tagsShowArchived,
  tagsShowTrashed,
} from "./ui.js";

// --- Storage ---

const storage = createStorage();

// --- Signals ---

export const notes = signal<Note[]>([]);

// --- Derived ---

export const filteredNotes = computed(() => {
  let result = notes.value;

  // Filter by view
  switch (activeView.value) {
    case "active":
      result = result.filter((n) => !n.archived && !n.trashed);
      break;
    case "tags":
      result = result.filter((n) => {
        if (n.trashed && !tagsShowTrashed.value) return false;
        if (n.archived && !tagsShowArchived.value) return false;
        if (n.trashed && n.archived) return tagsShowTrashed.value;
        return true;
      });
      if (activeTag.value) {
        const tag = activeTag.value;
        result = result.filter((n) => n.tags.includes(tag));
      }
      break;
    case "reminders":
      result = result.filter((n) => n.reminder && !n.trashed);
      break;
    case "archived":
      result = result.filter((n) => n.archived && !n.trashed);
      break;
    case "trash":
      result = result.filter((n) => n.trashed);
      break;
  }

  // Filter by search
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q),
    );
  }

  return result;
});

export const sortedNotes = computed(() => {
  const result = [...filteredNotes.value];
  if (activeView.value === "reminders") {
    result.sort((a, b) =>
      (a.reminder?.time ?? "").localeCompare(b.reminder?.time ?? ""),
    );
    return result;
  }
  switch (sortMode.value) {
    case "updated":
      result.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      break;
    case "created":
      result.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      break;
    default:
      result.sort((a, b) => a.position - b.position);
      break;
  }
  return result;
});

export const pinnedNotes = computed(() =>
  sortedNotes.value.filter((n) => n.pinned),
);

export const unpinnedNotes = computed(() =>
  sortedNotes.value.filter((n) => !n.pinned),
);

export const allTags = computed(() => {
  const tagSet = new Set<string>();
  for (const note of notes.value) {
    if (!note.trashed && !note.archived) {
      for (const tag of note.tags) {
        tagSet.add(tag);
      }
    }
  }
  return [...tagSet].sort();
});

export const editingNote = computed(() =>
  editingNoteId.value
    ? (notes.value.find((n) => n.id === editingNoteId.value) ?? null)
    : null,
);

/** Drag-and-drop reorder is only available in the Notes view, unfiltered, manual order, no modal open */
export const canReorder = computed(
  () =>
    activeView.value === "active" &&
    sortMode.value === "default" &&
    !searchQuery.value &&
    !editingNoteId.value,
);

// --- Helpers ---

const noteColors = Object.values(NoteColor).filter(
  (c) => c !== NoteColor.Default,
);

export function pickDefaultColor(): NoteColor {
  if (defaultNoteColor.value === "random") {
    return noteColors[Math.floor(Math.random() * noteColors.length)];
  }
  return NoteColor.Default;
}

const noteFonts = Object.values(NoteFont).filter((f) => f !== NoteFont.Default);

export function pickDefaultFont(): NoteFont {
  if (defaultNoteFont.value === "random") {
    return noteFonts[Math.floor(Math.random() * noteFonts.length)];
  }
  return defaultNoteFont.value;
}

// --- Actions ---

export async function loadNotes() {
  try {
    notes.value = await storage.getAll();
    await expireTrash();
  } catch (err) {
    console.error("Failed to load notes:", err);
    showError(t("error.loadFailed"));
  }
}

export async function createNote(input: Partial<NoteCreate>): Promise<Note> {
  const noteCreate: NoteCreate = {
    title: input.title ?? "",
    content: input.content ?? "",
    color: input.color ?? pickDefaultColor(),
    font: input.font ?? pickDefaultFont(),
    pinned: input.pinned ?? false,
    archived: input.archived ?? false,
    trashed: input.trashed ?? false,
    trashedAt: input.trashedAt ?? null,
    position: input.position ?? Date.now(),
    tags: input.tags ?? [],
    images: input.images ?? [],
    linkPreviews: input.linkPreviews ?? [],
    reminder: input.reminder ?? null,
  };
  try {
    const note = await storage.create(noteCreate);
    notes.value = [...notes.value, note];
    return note;
  } catch (err) {
    console.error("Failed to create note:", err);
    showError(t("error.createFailed"));
    throw err;
  }
}

export async function updateNote(id: string, changes: NoteUpdate) {
  try {
    const note = await storage.update(id, changes);
    notes.value = notes.value.map((n) => (n.id === id ? note : n));
    return note;
  } catch (err) {
    console.error(`Failed to update note ${id}:`, err);
    showError(t("error.saveFailed"));
    throw err;
  }
}

export async function permanentlyDeleteNote(id: string) {
  try {
    await storage.delete(id);
    notes.value = notes.value.filter((n) => n.id !== id);
    deleteVersions(id);
  } catch (err) {
    console.error(`Failed to delete note ${id}:`, err);
    showError(t("error.deleteFailed"));
    throw err;
  }
}

export async function deleteAllNotes() {
  await storage.deleteAll();
  notes.value = [];
}

export async function trashNote(id: string) {
  await updateNote(id, {
    trashed: true,
    trashedAt: new Date().toISOString(),
    archived: false,
  });
}

export async function restoreNote(id: string) {
  await updateNote(id, { trashed: false, trashedAt: null });
}

export async function archiveNote(id: string) {
  await updateNote(id, { archived: true });
}

export async function unarchiveNote(id: string) {
  await updateNote(id, { archived: false });
}

export async function togglePin(id: string) {
  const note = notes.value.find((n) => n.id === id);
  if (note) await updateNote(id, { pinned: !note.pinned });
}

export async function deleteTag(tag: string) {
  const affectedIds = notes.value
    .filter((n) => n.tags.includes(tag))
    .map((n) => n.id);
  for (const id of affectedIds) {
    const note = notes.value.find((n) => n.id === id);
    if (note) {
      await updateNote(id, { tags: note.tags.filter((t) => t !== tag) }).catch(
        () => {},
      );
    }
  }
  if (activeTag.value === tag) {
    activeTag.value = null;
  }
}

export async function addTagToNotes(tag: string, noteIds: Set<string>) {
  for (const id of noteIds) {
    const note = notes.value.find((n) => n.id === id);
    if (note && !note.tags.includes(tag)) {
      await updateNote(id, { tags: [...note.tags, tag] }).catch(() => {});
    }
  }
}

// --- Selection ---

export function enterSelectMode(noteId?: string) {
  selectMode.value = true;
  selectedNotes.value = noteId ? new Set([noteId]) : new Set();
}

export function exitSelectMode() {
  selectMode.value = false;
  selectedNotes.value = new Set();
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

export async function bulkPin() {
  const ids = [...selectedNotes.value];
  const allPinned = ids.every(
    (id) => notes.value.find((n) => n.id === id)?.pinned,
  );
  for (const id of ids) {
    if (notes.value.some((n) => n.id === id)) {
      await updateNote(id, { pinned: !allPinned }).catch(() => {});
    }
  }
  exitSelectMode();
}

export async function bulkArchive() {
  for (const id of [...selectedNotes.value]) {
    if (notes.value.some((n) => n.id === id)) {
      await archiveNote(id).catch(() => {});
    }
  }
  exitSelectMode();
}

export async function bulkTrash() {
  for (const id of [...selectedNotes.value]) {
    if (notes.value.some((n) => n.id === id)) {
      await trashNote(id).catch(() => {});
    }
  }
  exitSelectMode();
}

export async function bulkDelete() {
  for (const id of [...selectedNotes.value]) {
    if (notes.value.some((n) => n.id === id)) {
      await permanentlyDeleteNote(id).catch(() => {});
    }
  }
  exitSelectMode();
}

export async function bulkSetColor(color: NoteColor) {
  for (const id of [...selectedNotes.value]) {
    if (notes.value.some((n) => n.id === id)) {
      await updateNote(id, { color }).catch(() => {});
    }
  }
  exitSelectMode();
}

export async function bulkAddTag(tag: string) {
  await addTagToNotes(tag, selectedNotes.value);
  exitSelectMode();
}

export async function reorderNotes(
  noteIds: string[],
  fromIndex: number,
  toIndex: number,
) {
  if (fromIndex === toIndex) return;
  const reordered = [...noteIds];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  // Assign new positions based on array order
  for (let i = 0; i < reordered.length; i++) {
    await updateNote(reordered[i], { position: i });
  }
}

const CHECKBOX_LINE_RE = /^(\s*)((?:[-*+] )?)\[([ xX])\] (.*)$/;

export async function toggleCheckbox(id: string, lineIndex: number) {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return;
  const lines = note.content.split("\n");
  const m = lines[lineIndex].match(CHECKBOX_LINE_RE);
  if (!m) return;
  const [, indent, bullet, marker, rest] = m;
  const next = marker === " " ? "x" : " ";
  lines[lineIndex] = `${indent}${bullet}[${next}] ${rest}`;

  // Cascade to descendants — subsequent contiguous checkbox lines with
  // greater indent. Matches the editor's subtree toggle behavior.
  const parentIndent = indent.length;
  for (let i = lineIndex + 1; i < lines.length; i++) {
    const childMatch = lines[i].match(CHECKBOX_LINE_RE);
    if (!childMatch) break;
    const [, childIndent, childBullet, , childRest] = childMatch;
    if (childIndent.length <= parentIndent) break;
    lines[i] = `${childIndent}${childBullet}[${next}] ${childRest}`;
  }

  await updateNote(id, { content: lines.join("\n") });
}

export function exportNotes(): string {
  return JSON.stringify(notes.value, null, 2);
}

export async function importNotes(imported: Note[]) {
  try {
    await storage.importAll(imported);
    notes.value = await storage.getAll();
  } catch (err) {
    console.error("Failed to import notes:", err);
    showError(t("error.importFailed"));
    throw err;
  }
}

export async function expireTrash() {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const expired = notes.value.filter(
    (n) =>
      n.trashed &&
      n.trashedAt &&
      new Date(n.trashedAt).getTime() < thirtyDaysAgo,
  );
  for (const note of expired) {
    await permanentlyDeleteNote(note.id);
  }
}
