import type { NoteUpdate } from "@manifesto/shared";
import { effect, signal } from "@preact/signals";

/**
 * Overrides for each auto-note. The plugin of an auto-note makes it again on
 * each run. Thus, all metadata that the user sets (pin, color, tags, archive,
 * trash, reminder, position) is kept in this sidecar, with the synthetic id of
 * the note as the key (`generated:<pluginId>:<noteKey>`). Overrides merge on
 * top of what the plugin gives.
 */
export const AUTO_NOTE_OVERRIDE_FIELDS = [
  "pinned",
  "color",
  "tags",
  "archived",
  "trashed",
  "trashedAt",
  "position",
  "reminder",
] as const satisfies readonly (keyof NoteUpdate)[];

export type AutoNoteOverride = Pick<
  NoteUpdate,
  (typeof AUTO_NOTE_OVERRIDE_FIELDS)[number]
>;

const GENERATED_ID_PREFIX = "generated:";

/** The synthetic id of an auto-note. */
export function generatedNoteId(pluginId: string, noteKey: string): string {
  return `${GENERATED_ID_PREFIX}${pluginId}:${noteKey}`;
}

/** If a note id names an auto-note, not a stored note. */
export function isGeneratedNoteId(id: string): boolean {
  return id.startsWith(GENERATED_ID_PREFIX);
}

/**
 * The part of `changes` that an auto-note keeps. Its title and content belong
 * to the plugin.
 */
export function overrideFrom(changes: NoteUpdate): AutoNoteOverride {
  const override: Record<string, unknown> = {};
  for (const field of AUTO_NOTE_OVERRIDE_FIELDS) {
    if (changes[field] !== undefined) override[field] = changes[field];
  }
  return override as AutoNoteOverride;
}

const STORAGE_KEY = "manifesto:auto-note-overrides";

function isValidOverride(value: unknown): value is AutoNoteOverride {
  if (!value || typeof value !== "object") return false;
  const override = value as Record<string, unknown>;
  if (override.pinned !== undefined && typeof override.pinned !== "boolean") {
    return false;
  }
  if (override.color !== undefined && typeof override.color !== "string") {
    return false;
  }
  if (
    override.archived !== undefined &&
    typeof override.archived !== "boolean"
  ) {
    return false;
  }
  if (override.trashed !== undefined && typeof override.trashed !== "boolean") {
    return false;
  }
  if (
    override.trashedAt !== undefined &&
    override.trashedAt !== null &&
    typeof override.trashedAt !== "string"
  ) {
    return false;
  }
  if (
    override.position !== undefined &&
    typeof override.position !== "number"
  ) {
    return false;
  }
  if (override.tags !== undefined) {
    if (!Array.isArray(override.tags)) return false;
    if (!override.tags.every((t) => typeof t === "string")) return false;
  }
  if (override.reminder !== undefined && override.reminder !== null) {
    if (typeof override.reminder !== "object") return false;
    const reminder = override.reminder as Record<string, unknown>;
    if (typeof reminder.time !== "string") return false;
  }
  return true;
}

function load(): Record<string, AutoNoteOverride> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, AutoNoteOverride> = {};
    for (const [id, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidOverride(val)) out[id] = val;
    }
    return out;
  } catch {
    return {};
  }
}

export const autoNoteOverrides = signal<Record<string, AutoNoteOverride>>(
  load(),
);

effect(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(autoNoteOverrides.value));
  } catch {
    // Ignore quota and access failures.
  }
});

function merge(
  current: AutoNoteOverride | undefined,
  patch: AutoNoteOverride,
): AutoNoteOverride {
  return { ...(current ?? {}), ...patch };
}

export function updateAutoNoteOverride(id: string, patch: AutoNoteOverride) {
  const current = autoNoteOverrides.value;
  const next = { ...current, [id]: merge(current[id], patch) };
  autoNoteOverrides.value = next;
}

export function clearAutoNoteOverride(id: string) {
  const current = autoNoteOverrides.value;
  if (!(id in current)) return;
  const next = { ...current };
  delete next[id];
  autoNoteOverrides.value = next;
}
