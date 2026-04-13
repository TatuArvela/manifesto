import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";
import { NoteColor } from "@manifesto/shared";
import { computed, signal } from "@preact/signals";
import { LocalStorageAdapter } from "../storage/LocalStorageAdapter.js";

// --- Types ---

export type ViewMode = "grid" | "list";
export type NoteSize = "fit" | "square";
export type Filter = "active" | "archived" | "trash";
export type SortMode = "default" | "updated" | "created";

// --- Storage ---

const storage = new LocalStorageAdapter();

// --- Signals ---

// --- Persisted preferences ---

const PREFS_KEY = "manifesto:prefs";

function loadPrefs(): {
  viewMode: ViewMode;
  sortMode: SortMode;
  noteSize: NoteSize;
} {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        viewMode: parsed.viewMode ?? "grid",
        sortMode: parsed.sortMode ?? "default",
        noteSize: parsed.noteSize ?? "fit",
      };
    }
  } catch {
    // ignore
  }
  return { viewMode: "grid", sortMode: "default", noteSize: "fit" };
}

function savePrefs() {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({
      viewMode: viewMode.value,
      sortMode: sortMode.value,
      noteSize: noteSize.value,
    }),
  );
}

const prefs = loadPrefs();

export const notes = signal<Note[]>([]);
export const searchQuery = signal("");
export const viewMode = signal<ViewMode>(prefs.viewMode);
export const noteSize = signal<NoteSize>(prefs.noteSize);
export const filter = signal<Filter>("active");
export const activeTag = signal<string | null>(null);
export const sortMode = signal<SortMode>(prefs.sortMode);
export const editingNoteId = signal<string | null>(null);
export const mobileSidebarOpen = signal(false);

// Persist preferences when they change
viewMode.subscribe(() => savePrefs());
sortMode.subscribe(() => savePrefs());
noteSize.subscribe(() => savePrefs());

// --- Derived ---

export const filteredNotes = computed(() => {
  let result = notes.value;

  // Filter by view
  switch (filter.value) {
    case "active":
      result = result.filter((n) => !n.archived && !n.trashed);
      break;
    case "archived":
      result = result.filter((n) => n.archived && !n.trashed);
      break;
    case "trash":
      result = result.filter((n) => n.trashed);
      break;
  }

  // Filter by tag
  if (activeTag.value) {
    result = result.filter((n) => n.tags.includes(activeTag.value!));
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

// --- Actions ---

export async function loadNotes() {
  notes.value = await storage.getAll();
  await expireTrash();
}

export async function createNote(input: Partial<NoteCreate>): Promise<Note> {
  const noteCreate: NoteCreate = {
    title: input.title ?? "",
    content: input.content ?? "",
    color: input.color ?? NoteColor.Default,
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
