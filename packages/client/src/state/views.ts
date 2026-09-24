import type { Note } from "@manifesto/shared";
import { imageCountOf } from "@manifesto/shared";
import { computed } from "@preact/signals";
import { hasChecklist } from "../utils/markdown.js";
import { allNotes } from "./notesStore.js";
import { byPosition } from "./ordering.js";
import { hiddenTags, sortMode } from "./prefs.js";
import {
  activeTag,
  activeView,
  editingNoteId,
  searchColors,
  searchLocations,
  searchQuery,
  searchTypes,
  tagsShowActive,
  tagsShowArchived,
  tagsShowTrashed,
} from "./ui.js";

/**
 * Whether the current view has room for a note where it lives: active,
 * archived or trashed, and for the reminders and auto-notes views what kind of
 * note it is. The part of a view's filter that archiving, trashing and
 * restoring change, so they can tell whether the card is about to leave.
 */
export function inViewLocation(
  n: Pick<Note, "archived" | "trashed" | "readonly" | "reminder">,
): boolean {
  switch (activeView.value) {
    case "active":
      return !n.archived && !n.trashed;
    case "tags":
      if (n.trashed) return tagsShowTrashed.value;
      if (n.archived) return tagsShowArchived.value;
      return tagsShowActive.value;
    case "reminders":
      return !!n.reminder && !n.trashed;
    case "autoNotes":
      return !!n.readonly && !n.archived && !n.trashed;
    case "archived":
      return n.archived && !n.trashed;
    case "trash":
      return n.trashed;
    case "search": {
      const locations = searchLocations.value;
      if (n.trashed) return locations.has("trashed");
      if (n.archived) return locations.has("archived");
      return locations.has("active");
    }
    default:
      return true;
  }
}

const hiddenTagSet = computed(() => new Set(hiddenTags.value));

function hasHiddenTag(note: Note, hidden: Set<string>): boolean {
  return hidden.size > 0 && note.tags.some((tag) => hidden.has(tag));
}

/**
 * How many notes the Notes view leaves out because of a hidden tag, so an
 * empty board can say why it is empty rather than claim there are no notes.
 */
export const notesHiddenByTag = computed(() => {
  const hidden = hiddenTagSet.value;
  if (hidden.size === 0) return 0;
  return allNotes.value.filter(
    (n) => !n.archived && !n.trashed && hasHiddenTag(n, hidden),
  ).length;
});

/** Keeps a tag's notes out of the Notes view, or lets them back in. */
export function setTagHidden(tag: string, hide: boolean) {
  const rest = hiddenTags.value.filter((t) => t !== tag);
  hiddenTags.value = hide ? [...rest, tag] : rest;
}

export const filteredNotes = computed(() => {
  let result: Note[] = allNotes.value;

  switch (activeView.value) {
    case "active":
      result = result.filter(
        (n) => inViewLocation(n) && !hasHiddenTag(n, hiddenTagSet.value),
      );
      break;
    case "reminders":
    case "autoNotes":
    case "archived":
    case "trash":
      result = result.filter(inViewLocation);
      break;
    case "tags":
      result = result.filter(inViewLocation);
      if (activeTag.value) {
        const tag = activeTag.value;
        result = result.filter((n) => n.tags.includes(tag));
      }
      break;
    case "search": {
      const types = searchTypes.value;
      const colors = searchColors.value;
      if (!searchQuery.value && types.size === 0 && colors.size === 0) {
        result = [];
        break;
      }
      result = result.filter(inViewLocation);
      if (types.size > 0) {
        result = result.filter((n) => {
          if (types.has("reminders") && n.reminder) return true;
          if (types.has("images") && imageCountOf(n) > 0) return true;
          if (types.has("urls") && n.linkPreviews.length > 0) return true;
          if (types.has("checklists") && hasChecklist(n.content)) return true;
          return false;
        });
      }
      if (colors.size > 0) {
        result = result.filter((n) => colors.has(n.color));
      }
      break;
    }
  }

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

/**
 * Newest first by a timestamp, parsing each one once. Not compared as
 * strings: they are ISO, but not all written with milliseconds, and those do
 * not sort as text. A missing or unreadable one counts as the epoch.
 */
function newestFirst(
  list: Note[],
  time: (n: Note) => string | null | undefined,
): Note[] {
  return list
    .map((note) => ({ note, at: Date.parse(time(note) ?? "") || 0 }))
    .sort((a, b) => b.at - a.at)
    .map(({ note }) => note);
}

export const sortedNotes = computed(() => {
  const result = [...filteredNotes.value];
  if (activeView.value === "reminders") {
    result.sort((a, b) =>
      (a.reminder?.time ?? "").localeCompare(b.reminder?.time ?? ""),
    );
    return result;
  }
  if (activeView.value === "trash") {
    return newestFirst(result, (n) => n.trashedAt);
  }
  switch (sortMode.value) {
    case "updated":
      return newestFirst(result, (n) => n.updatedAt);
    case "created":
      return newestFirst(result, (n) => n.createdAt);
    default:
      return result.sort(byPosition);
  }
});

export const pinnedNotes = computed(() =>
  sortedNotes.value.filter((n) => n.pinned),
);

export const unpinnedNotes = computed(() =>
  sortedNotes.value.filter((n) => !n.pinned),
);

/** How many notes, neither archived nor trashed, carry each tag. */
export const tagCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const note of allNotes.value) {
    if (!note.trashed && !note.archived) {
      for (const tag of note.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  return counts;
});

export const allTags = computed(() => [...tagCounts.value.keys()].sort());

export const editingNote = computed(() =>
  editingNoteId.value
    ? (allNotes.value.find((n) => n.id === editingNoteId.value) ?? null)
    : null,
);

/** Drag-and-drop reorder: Notes or Auto-notes view, manual order, no search,
 * no modal open. */
export const canReorder = computed(
  () =>
    (activeView.value === "active" || activeView.value === "autoNotes") &&
    sortMode.value === "default" &&
    !searchQuery.value &&
    !editingNoteId.value,
);
