import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { computed, signal } from "@preact/signals";
import { LocalStorageAdapter } from "../storage/LocalStorageAdapter.js";

// --- Types ---

export type ViewMode = "grid" | "list";
export type NoteSize = "fit" | "square";
export type AppView = "active" | "tags" | "archived" | "trash";
export type SortMode = "default" | "updated" | "created";
export type ThemeMode = "system" | "light" | "dark";
export type DefaultNoteColor = "plain" | "random";
export type DefaultNoteFont = NoteFont | "random";

// --- Storage ---

const storage = new LocalStorageAdapter();

// --- Signals ---

// --- Persisted preferences ---

const PREFS_KEY = "manifesto:prefs";

function loadPrefs(): {
  viewMode: ViewMode;
  sortMode: SortMode;
  noteSize: NoteSize;
  theme: ThemeMode;
  defaultNoteColor: DefaultNoteColor;
  defaultNoteFont: DefaultNoteFont;
} {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        viewMode: parsed.viewMode ?? "grid",
        sortMode: parsed.sortMode ?? "default",
        noteSize: parsed.noteSize ?? "fit",
        theme: parsed.theme ?? "system",
        defaultNoteColor: parsed.defaultNoteColor ?? "plain",
        defaultNoteFont:
          parsed.defaultNoteFont ?? parsed.noteFont ?? NoteFont.Default,
      };
    }
  } catch {
    // ignore
  }
  return {
    viewMode: "grid",
    sortMode: "default",
    noteSize: "fit",
    theme: "system",
    defaultNoteColor: "plain",
    defaultNoteFont: NoteFont.Default,
  };
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
    }),
  );
}

const prefs = loadPrefs();

export const notes = signal<Note[]>([]);
export const searchQuery = signal("");
export const viewMode = signal<ViewMode>(prefs.viewMode);
export const noteSize = signal<NoteSize>(prefs.noteSize);
export const activeView = signal<AppView>("active");
export const activeTag = signal<string | null>(null);
export const tagsShowArchived = signal(false);
export const tagsShowTrashed = signal(false);
export const tagsSelectMode = signal(false);
export const tagsSelectedNotes = signal<Set<string>>(new Set());
export const sortMode = signal<SortMode>(prefs.sortMode);
export const editingNoteId = signal<string | null>(null);
export const mobileSidebarOpen = signal(false);
export const showSettings = signal(false);
export const theme = signal<ThemeMode>(prefs.theme);
export const defaultNoteColor = signal<DefaultNoteColor>(
  prefs.defaultNoteColor,
);
export const defaultNoteFont = signal<DefaultNoteFont>(prefs.defaultNoteFont);

// Persist preferences when they change
viewMode.subscribe(() => savePrefs());
sortMode.subscribe(() => savePrefs());
noteSize.subscribe(() => savePrefs());
theme.subscribe(() => savePrefs());
defaultNoteColor.subscribe(() => savePrefs());
defaultNoteFont.subscribe(() => savePrefs());

// --- Theme ---

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

applyTheme(theme.value);
theme.subscribe((mode) => applyTheme(mode));

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (theme.value === "system") applyTheme("system");
  });

// --- Note font ---

export const noteFontFamilies: Record<NoteFont, string> = {
  [NoteFont.Default]: "",
  [NoteFont.PermanentMarker]: '"Permanent Marker", cursive',
  [NoteFont.ComicRelief]: '"Comic Relief", cursive',
};

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
        result = result.filter((n) => n.tags.includes(activeTag.value!));
      }
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
  notes.value = await storage.getAll();
  await expireTrash();
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
  };
  const note = await storage.create(noteCreate);
  notes.value = [...notes.value, note];
  return note;
}

export async function updateNote(id: string, changes: NoteUpdate) {
  const note = await storage.update(id, changes);
  notes.value = notes.value.map((n) => (n.id === id ? note : n));
  return note;
}

export async function deleteNote(id: string) {
  await storage.delete(id);
  notes.value = notes.value.filter((n) => n.id !== id);
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
  const affected = notes.value.filter((n) => n.tags.includes(tag));
  for (const note of affected) {
    await updateNote(note.id, { tags: note.tags.filter((t) => t !== tag) });
  }
  if (activeTag.value === tag) {
    activeTag.value = null;
  }
}

export async function addTagToNotes(tag: string, noteIds: Set<string>) {
  for (const id of noteIds) {
    const note = notes.value.find((n) => n.id === id);
    if (note && !note.tags.includes(tag)) {
      await updateNote(id, { tags: [...note.tags, tag] });
    }
  }
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

export async function toggleCheckbox(id: string, lineIndex: number) {
  const note = notes.value.find((n) => n.id === id);
  if (!note) return;
  const lines = note.content.split("\n");
  const line = lines[lineIndex];
  // Support both "- [ ] text" and "[] text" formats
  if (/^- \[ \] /.test(line)) {
    lines[lineIndex] = line.replace("- [ ] ", "- [x] ");
  } else if (/^- \[x\] /i.test(line)) {
    lines[lineIndex] = line.replace(/^- \[x\] /i, "- [ ] ");
  } else if (/^\[ \] /.test(line)) {
    lines[lineIndex] = line.replace("[ ] ", "[x] ");
  } else if (/^\[x\] /i.test(line)) {
    lines[lineIndex] = line.replace(/^\[x\] /i, "[ ] ");
  }
  await updateNote(id, { content: lines.join("\n") });
}

export function exportNotes(): string {
  return JSON.stringify(notes.value, null, 2);
}

export async function importNotes(imported: Note[]) {
  await storage.importAll(imported);
  notes.value = await storage.getAll();
}

async function expireTrash() {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const expired = notes.value.filter(
    (n) =>
      n.trashed &&
      n.trashedAt &&
      new Date(n.trashedAt).getTime() < thirtyDaysAgo,
  );
  for (const note of expired) {
    await deleteNote(note.id);
  }
}
