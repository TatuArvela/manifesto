import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { computed, signal } from "@preact/signals";
import { t } from "../i18n/index.js";
import { createStorage } from "../storage/index.js";
import { NoteConflictError } from "../storage/RestApiAdapter.js";
import { deleteVersions } from "../storage/VersionStorage.js";
import {
  clearAutoNoteOverride,
  updateAutoNoteOverride,
} from "./autoNoteOverrides.js";
import { generatedNotes } from "./autoNotes.js";
import { mergeNoteUpdate } from "./mergeNote.js";
import { defaultNoteColor, defaultNoteFont, sortMode } from "./prefs.js";
import {
  activeTag,
  activeView,
  editingNoteId,
  searchColors,
  searchLocations,
  searchQuery,
  searchTypes,
  selectedNotes,
  selectMode,
  showError,
  tagsShowActive,
  tagsShowArchived,
  tagsShowTrashed,
} from "./ui.js";

// --- Storage ---

const storage = createStorage();

// --- Signals ---

export const notes = signal<Note[]>([]);

/**
 * All notes visible to the UI — user notes plus plugin-generated read-only
 * notes. Generated notes' metadata (pin/color/tags/archive/trash/reminder)
 * can be overridden by the user; the override sidecar is merged into the
 * rendered note inside `autoNotes.toNote`.
 */
export const allNotes = computed<Note[]>(() => [
  ...notes.value,
  ...generatedNotes.value,
]);

// --- Derived ---

const CHECKBOX_LINE_RE = /^(\s*)((?:[-*+] )?)\[([ xX])\] (.*)$/;

export function noteHasChecklist(content: string): boolean {
  return content.split("\n").some((line) => CHECKBOX_LINE_RE.test(line));
}

export const filteredNotes = computed(() => {
  let result: Note[] = allNotes.value;

  // Filter by view
  switch (activeView.value) {
    case "active":
      result = result.filter((n) => !n.archived && !n.trashed);
      break;
    case "tags":
      result = result.filter((n) => {
        if (n.trashed) return tagsShowTrashed.value;
        if (n.archived) return tagsShowArchived.value;
        return tagsShowActive.value;
      });
      if (activeTag.value) {
        const tag = activeTag.value;
        result = result.filter((n) => n.tags.includes(tag));
      }
      break;
    case "reminders":
      result = result.filter((n) => n.reminder && !n.trashed);
      break;
    case "autoNotes":
      result = result.filter((n) => n.readonly && !n.archived && !n.trashed);
      break;
    case "archived":
      result = result.filter((n) => n.archived && !n.trashed);
      break;
    case "trash":
      result = result.filter((n) => n.trashed);
      break;
    case "search": {
      const types = searchTypes.value;
      const colors = searchColors.value;
      if (!searchQuery.value && types.size === 0 && colors.size === 0) {
        result = [];
        break;
      }
      const locations = searchLocations.value;
      result = result.filter((n) => {
        if (n.trashed) return locations.has("trashed");
        if (n.archived) return locations.has("archived");
        return locations.has("active");
      });
      if (types.size > 0) {
        result = result.filter((n) => {
          if (types.has("reminders") && n.reminder) return true;
          if (types.has("images") && n.images.length > 0) return true;
          if (types.has("urls") && n.linkPreviews.length > 0) return true;
          if (types.has("checklists") && noteHasChecklist(n.content))
            return true;
          return false;
        });
      }
      if (colors.size > 0) {
        result = result.filter((n) => colors.has(n.color));
      }
      break;
    }
  }

  // Filter by search query
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
  if (activeView.value === "trash") {
    result.sort(
      (a, b) =>
        new Date(b.trashedAt ?? 0).getTime() -
        new Date(a.trashedAt ?? 0).getTime(),
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
  for (const note of allNotes.value) {
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
    ? (allNotes.value.find((n) => n.id === editingNoteId.value) ?? null)
    : null,
);

/** Drag-and-drop reorder is available in the Notes and Auto-notes views, unfiltered, manual order, no modal open */
export const canReorder = computed(
  () =>
    (activeView.value === "active" || activeView.value === "autoNotes") &&
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

// Reorder writes spaced positions so a future tweak (insert-between, etc.)
// doesn't have to renumber the whole list. Date.now() in createNote is always
// larger than these spaced positions, so new notes consistently sort to the
// end of the manual-order list — same as the pre-reorder behavior.
const POSITION_STEP = 1000;

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
  // Generated notes have readonly title/content but mutable metadata. Route
  // the allowed fields to the per-note override sidecar.
  if (id.startsWith("generated:")) {
    const {
      pinned,
      color,
      tags,
      archived,
      trashed,
      trashedAt,
      reminder,
      position,
    } = changes;
    updateAutoNoteOverride(id, {
      ...(pinned !== undefined && { pinned }),
      ...(color !== undefined && { color }),
      ...(tags !== undefined && { tags }),
      ...(archived !== undefined && { archived }),
      ...(trashed !== undefined && { trashed }),
      ...(trashedAt !== undefined && { trashedAt }),
      ...(reminder !== undefined && { reminder }),
      ...(position !== undefined && { position }),
    });
    return null;
  }
  const base = notes.value.find((n) => n.id === id) ?? null;
  try {
    const note = await storage.update(
      id,
      changes,
      base ? { ifMatch: base.updatedAt } : undefined,
    );
    notes.value = notes.value.map((n) => (n.id === id ? note : n));
    return note;
  } catch (err) {
    if (err instanceof NoteConflictError && base) {
      // Lost the optimistic-concurrency race against a concurrent writer
      // (another tab / device of the same user). 3-way merge against the
      // server's current state and retry exactly once.
      const merged = mergeNoteUpdate(base, changes, err.currentNote);
      try {
        const note = await storage.update(id, merged, {
          ifMatch: err.currentNote.updatedAt,
        });
        notes.value = notes.value.map((n) => (n.id === id ? note : n));
        return note;
      } catch (retryErr) {
        console.error(`Conflict retry failed for note ${id}:`, retryErr);
        showError(t("error.saveFailed"));
        throw retryErr;
      }
    }
    console.error(`Failed to update note ${id}:`, err);
    showError(t("error.saveFailed"));
    throw err;
  }
}

export async function permanentlyDeleteNote(id: string) {
  // "Permanent delete" on an auto-note clears the override — the note will
  // reappear on the next render in its default state. (The plugin still owns
  // the source of truth; deletion is never truly permanent for auto-notes.)
  if (id.startsWith("generated:")) {
    clearAutoNoteOverride(id);
    return;
  }
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
  try {
    await storage.deleteAll();
    // Re-read instead of assuming []. RestApiAdapter deletes one-by-one and a
    // partial failure (caught above) would otherwise leave the signal lying.
    notes.value = await storage.getAll();
  } catch (err) {
    console.error("Failed to delete all notes:", err);
    showError(t("error.deleteFailed"));
    notes.value = await storage.getAll().catch(() => notes.value);
    throw err;
  }
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
  const note = allNotes.value.find((n) => n.id === id);
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

export function selectAllVisible() {
  const ids = sortedNotes.value.filter((n) => !n.readonly).map((n) => n.id);
  const current = selectedNotes.value;
  const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
  if (allSelected) {
    const next = new Set(current);
    for (const id of ids) next.delete(id);
    selectedNotes.value = next;
    if (next.size === 0) selectMode.value = false;
  } else {
    const next = new Set(current);
    for (const id of ids) next.add(id);
    selectedNotes.value = next;
    if (next.size > 0) selectMode.value = true;
  }
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

export async function bulkRestore() {
  for (const id of [...selectedNotes.value]) {
    if (notes.value.some((n) => n.id === id)) {
      await restoreNote(id).catch(() => {});
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
  // Spaced positions so new notes can slot above without colliding with the
  // existing range. See nextCreatePosition.
  for (let i = 0; i < reordered.length; i++) {
    await updateNote(reordered[i], { position: (i + 1) * POSITION_STEP });
  }
}

export function hasCheckedItems(content: string): boolean {
  return content.split("\n").some((line) => {
    const m = line.match(CHECKBOX_LINE_RE);
    return !!m && m[3].toLowerCase() === "x";
  });
}

export async function deleteCheckedItems(id: string) {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return;
  const lines = note.content.split("\n");
  const toRemove = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CHECKBOX_LINE_RE);
    if (!m) continue;
    const [, indent, , marker] = m;
    if (marker.toLowerCase() !== "x") continue;
    toRemove.add(i);
    // Sweep up indented descendants so subtrees go with their parent.
    const parentIndent = indent.length;
    for (let j = i + 1; j < lines.length; j++) {
      const childMatch = lines[j].match(CHECKBOX_LINE_RE);
      if (!childMatch) break;
      if (childMatch[1].length <= parentIndent) break;
      toRemove.add(j);
    }
  }

  if (toRemove.size === 0) return;
  const next = lines.filter((_, i) => !toRemove.has(i)).join("\n");
  await updateNote(id, { content: next });
}

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
