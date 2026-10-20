import { NoteColor, NoteFont } from "@manifesto/shared";
import type { AutoNoteResult } from "./types.ts";

/**
 * The maximum number of notes that one plugin call can make. A loop that
 * appends a note on each iteration is a likely mistake, and the grid renders
 * each one.
 */
export const MAX_NOTES_PER_RUN = 100;

/**
 * The same as the limit of the server on `tags`. Thus, a generated note can be
 * saved.
 */
const MAX_TAGS = 50;

const NOTE_COLORS = new Set<string>(Object.values(NoteColor));
const NOTE_FONTS = new Set<string>(Object.values(NoteFont));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * One plugin function can return a note or an array of notes, and a plugin can
 * export many functions. Thus, the sandbox gives back an array of arrays or
 * notes. The code flattens one more level than that, on purpose. Nesting is a
 * mistake that a plugin can make, and an unwrap is friendlier than a refusal.
 */
function flatten(value: unknown, depth: number): unknown[] {
  if (!Array.isArray(value)) return [value];
  if (depth === 0) return value;
  return value.flatMap((entry) => flatten(entry, depth - 1));
}

function toResult(raw: unknown): AutoNoteResult {
  if (!isRecord(raw)) {
    throw new Error("plugin returned a non-object note");
  }
  if (typeof raw.title !== "string" || typeof raw.content !== "string") {
    throw new Error("note must have string title and content");
  }
  const out: AutoNoteResult = { title: raw.title, content: raw.content };
  // All fields after the title and the content are optional. The code removes a
  // bad value, and does not throw. `toNote` has a default for each, and one
  // incorrectly spelled color must not remove the full run of the plugin. The
  // code checks the color and the font against the enums, because they are keys
  // of `noteColorMap` / `noteFontFamilies`. An unknown string gives `undefined`
  // there, and throws while a card renders.
  if (typeof raw.color === "string" && NOTE_COLORS.has(raw.color)) {
    out.color = raw.color as NoteColor;
  }
  if (typeof raw.font === "string" && NOTE_FONTS.has(raw.font)) {
    out.font = raw.font as NoteFont;
  }
  if (typeof raw.pinned === "boolean") out.pinned = raw.pinned;
  if (Array.isArray(raw.tags)) {
    out.tags = raw.tags
      .filter((tag): tag is string => typeof tag === "string")
      .slice(0, MAX_TAGS);
  }
  // Only finite values. The sort uses `position`, and a NaN comparison silently
  // puts all notes around it in a random order.
  if (typeof raw.position === "number" && Number.isFinite(raw.position)) {
    out.position = raw.position;
  }
  if (typeof raw.key === "string") out.key = raw.key;
  return out;
}

/**
 * Changes the data from the sandbox into notes, or throws.
 *
 * This is the trust boundary. The sandbox evaluates code that the user pasted.
 * Thus, nothing that it says about its own output can be trusted. The check is
 * here, on the side of the app. A plugin that took control of its frame would
 * pass the own checks of the frame.
 */
export function toAutoNoteResults(value: unknown): AutoNoteResult[] {
  const raw = flatten(value, 2);
  if (raw.length > MAX_NOTES_PER_RUN) {
    throw new Error(
      `plugin returned ${raw.length} notes; the limit is ${MAX_NOTES_PER_RUN}`,
    );
  }
  return raw.map(toResult);
}
