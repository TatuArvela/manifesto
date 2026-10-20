import type { Note } from "@manifesto/shared";
import {
  imageCountOf,
  isTagWithin,
  tagLineage,
  tagParent,
} from "@manifesto/shared";
import { computed } from "@preact/signals";
import { hasChecklist } from "#/utils/markdown.ts";
import {
  containsTerms,
  foldForSearch,
  searchTerms,
} from "#/utils/searchText.ts";
import { allNotes } from "./notesStore.ts";
import { byPosition } from "./ordering.ts";
import {
  hiddenTags,
  MAX_TAG_COLORS,
  sortMode,
  type TagColor,
  tagColors,
} from "./prefs.ts";
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
} from "./ui.ts";

/**
 * If the current view has a place for a note where it is: active, archived or
 * trashed, and for the reminders and auto-notes views the kind of note. This is
 * the part of the filter of a view that an archive, a trash or a restore
 * changes. Thus, they can tell if the card is about to go.
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

/**
 * If `tag` or a tag above it is in `set`. What a parent has, its subtags also
 * have.
 */
function withinAny(tag: string, set: Set<string>): boolean {
  return tagLineage(tag).some((at) => set.has(at));
}

function hasHiddenTag(note: Note, hidden: Set<string>): boolean {
  return hidden.size > 0 && note.tags.some((tag) => withinAny(tag, hidden));
}

/**
 * The hidden tag that keeps `tag` out of the Notes view: the tag itself, or the
 * nearest hidden tag above it. Null when it shows.
 */
export function hiddenThrough(tag: string): string | null {
  const hidden = hiddenTagSet.value;
  return (
    tagLineage(tag)
      .reverse()
      .find((at) => hidden.has(at)) ?? null
  );
}

/**
 * The color of a tag: its own, or that of the nearest tag above it that has
 * one.
 */
export function tagColorOf(tag: string): TagColor | undefined {
  const colors = tagColors.value;
  for (const at of tagLineage(tag).reverse()) {
    const color = colors[at];
    if (color !== undefined) return color;
  }
  return undefined;
}

/**
 * How many notes the Notes view does not show because of a hidden tag. Thus, an
 * empty board can tell why it is empty, and does not say that there are no
 * notes.
 */
export const notesHiddenByTag = computed(() => {
  const hidden = hiddenTagSet.value;
  if (hidden.size === 0) return 0;
  return allNotes.value.filter(
    (n) => !n.archived && !n.trashed && hasHiddenTag(n, hidden),
  ).length;
});

/** Keeps the notes of a tag out of the Notes view, or lets them back in. */
export function setTagHidden(tag: string, hide: boolean) {
  const rest = hiddenTags.value.filter((t) => t !== tag);
  hiddenTags.value = hide ? [...rest, tag] : rest;
}

/**
 * Gives a tag its color, or removes it with `null`. False when the tag would be
 * one colored tag too many. See `MAX_TAG_COLORS`.
 */
export function setTagColor(tag: string, color: TagColor | null): boolean {
  const { [tag]: _old, ...rest } = tagColors.value;
  if (color === null) {
    tagColors.value = rest;
    return true;
  }
  if (Object.keys(rest).length >= MAX_TAG_COLORS) return false;
  tagColors.value = { ...rest, [tag]: color };
  return true;
}

const queryTerms = computed(() => searchTerms(searchQuery.value));

interface FoldedNote {
  title: string;
  content: string;
  folded: { title: string; all: string };
}

/**
 * The text of each note folded one time, not on each keystroke. The source
 * strings are kept next to it. Thus, a note changed in place is folded again.
 */
const foldedCache = new WeakMap<Note, FoldedNote>();

function foldedText(note: Note): { title: string; all: string } {
  const cached = foldedCache.get(note);
  if (cached?.title === note.title && cached.content === note.content) {
    return cached.folded;
  }
  const title = foldForSearch(note.title);
  const folded = { title, all: `${title}\n${foldForSearch(note.content)}` };
  foldedCache.set(note, { title: note.title, content: note.content, folded });
  return folded;
}

/**
 * The notes of a search, with first the notes whose title contains one of its
 * words. The sort keeps its order within each group. Thus, the sort mode of the
 * view still decides all other things.
 */
function titleMatchesFirst(list: Note[]): Note[] {
  const terms = queryTerms.value;
  if (activeView.value !== "search" || terms.length === 0) return list;
  const inTitle = (n: Note) =>
    terms.some((term) => foldedText(n).title.includes(term));
  return [...list.filter(inTitle), ...list.filter((n) => !inTitle(n))];
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
        // The notes of a tag are its own notes and those of each tag under it.
        result = result.filter((n) => n.tags.some((t) => isTagWithin(t, tag)));
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

  const terms = queryTerms.value;
  if (terms.length > 0) {
    result = result.filter((n) => containsTerms(foldedText(n).all, terms));
  }

  return result;
});

/**
 * Newest first by a timestamp, with each one parsed one time. Not compared as
 * strings. They are ISO, but not all are written with milliseconds, and those
 * do not sort as text. A missing or unreadable timestamp counts as the epoch.
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
      return titleMatchesFirst(newestFirst(result, (n) => n.updatedAt));
    case "created":
      return titleMatchesFirst(newestFirst(result, (n) => n.createdAt));
    default:
      return titleMatchesFirst(result.sort(byPosition));
  }
});

export const pinnedNotes = computed(() =>
  sortedNotes.value.filter((n) => n.pinned),
);

export const unpinnedNotes = computed(() =>
  sortedNotes.value.filter((n) => !n.pinned),
);

/**
 * How many notes, neither archived nor trashed, are under each tag: the notes
 * that have it and the notes that have a tag below it, each note one time.
 * Thus, a tag that exists only as the start of a different tag (`work` in
 * `work/clients`) is also here. That makes it a tag that the user can open,
 * hide or add.
 */
export const tagCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const note of allNotes.value) {
    if (!note.trashed && !note.archived) {
      const under = new Set(note.tags.flatMap(tagLineage));
      for (const tag of under) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  return counts;
});

export const allTags = computed(() => [...tagCounts.value.keys()].sort());

/** The tags directly under `parent`, or the top-level tags for null. */
export function childTags(parent: string | null): string[] {
  return allTags.value.filter((tag) => tagParent(tag) === parent);
}

export const editingNote = computed(() =>
  editingNoteId.value
    ? (allNotes.value.find((n) => n.id === editingNoteId.value) ?? null)
    : null,
);

/**
 * Reorder with drag and drop: Notes or Auto-notes view, manual order, no
 * search, no modal open.
 */
export const canReorder = computed(
  () =>
    (activeView.value === "active" || activeView.value === "autoNotes") &&
    sortMode.value === "default" &&
    !searchQuery.value &&
    !editingNoteId.value,
);
