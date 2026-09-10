import { NoteColor, NoteFont } from "@manifesto/shared";
import type { AutoNoteResult } from "./types.js";

/**
 * How many notes one plugin invocation may produce. A loop that appends a
 * note per iteration is a plausible mistake, and the grid renders every one
 * of them.
 */
export const MAX_NOTES_PER_RUN = 100;

/** Matches the server's cap on `tags`, so a generated note can be saved. */
const MAX_TAGS = 50;

const NOTE_COLORS = new Set<string>(Object.values(NoteColor));
const NOTE_FONTS = new Set<string>(Object.values(NoteFont));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * One plugin function may return a note or an array of them, and a plugin may
 * export several functions, so the sandbox hands back an array of arrays-or-
 * notes. Flattened one level deeper than that on purpose: nesting is a
 * plugin's mistake to make, and unwrapping it is friendlier than refusing it.
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
  // Everything past title and content is optional, and a bad value is
  // dropped rather than thrown: `toNote` has a default for each, and one
  // misspelled colour shouldn't cost the plugin its whole run. Colour and
  // font are checked against the enums because they index `noteColorMap` /
  // `noteFontFamilies` — an unrecognized string reaches `undefined` there
  // and throws while a card renders.
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
  // Finite only: `position` is sorted on, and a NaN comparison silently
  // scrambles the order of every note around it.
  if (typeof raw.position === "number" && Number.isFinite(raw.position)) {
    out.position = raw.position;
  }
  if (typeof raw.key === "string") out.key = raw.key;
  return out;
}

/**
 * Turns whatever the sandbox sent into notes, or throws.
 *
 * This is the trust boundary. The sandbox evaluates code the user pasted in,
 * so nothing it says about its own output can be taken at face value — it
 * used to do this check itself, on the wrong side of the boundary, and a
 * plugin that subverted its frame could hand the app any shape it liked.
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
