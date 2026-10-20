import type { Note, NoteUpdate } from "#/note.ts";

/**
 * What the words of a note mean, as a number that increases
 * (`docs/specification/data-model.md`, "Format").
 *
 * The app always keeps a note in the current format. Each place that keeps a
 * note records its format (the open-mode store, a sealed note and its versions,
 * the copy of a public link, an export, a note that waits on the device). The
 * code that reads a note from there upgrades it with the steps below before
 * other code gets it. If a note is in a format that is newer than this build
 * knows, the app never shows it as if it understood it, and never writes over
 * it. You must reload an older tab or an old cached build first.
 *
 * Format 1 is each note as it was when the app started to record formats. A
 * change to what the words of a note contain (a new way to write something in
 * the text, a field of an image entry read differently) is a new step at the
 * end of `NOTE_FORMAT_STEPS`. That makes the format one higher. Never edit a
 * step that is already released, because a stored note remembers which steps it
 * had.
 */

/**
 * The part of a note that its format describes. A version keeps only the title
 * and the text, and the copy of a public link has no color or tags. Thus, a
 * step gets the fields that the holder has.
 */
export type NoteWords = Pick<
  Note,
  "title" | "content" | "font" | "images" | "imageAlts" | "linkPreviews"
>;

/**
 * One step, from the previous format to its own. It changes the fields that it
 * gets, and adds none. A version with only its title and text comes out with
 * only those.
 */
export type NoteFormatStep = (words: Partial<NoteWords>) => Partial<NoteWords>;

/** Step `i` moves a note from format `i + 1` to `i + 2`. */
export const NOTE_FORMAT_STEPS: readonly NoteFormatStep[] = [];

let steps: readonly NoteFormatStep[] = NOTE_FORMAT_STEPS;

/** The format that this build writes, and the newest that it can read. */
export function currentNoteFormat(): number {
  return steps.length + 1;
}

/** If a newer build than this one wrote a note kept in `format`. */
export function isNewerNoteFormat(format: number): boolean {
  return format > currentNoteFormat();
}

/**
 * Thrown where code would read a note in a newer format as this build
 * understands it, or write over it: the open-mode store, an export, and a write
 * that the server refused for this reason (`note_format_newer`), which does not
 * tell the format. A sealed note in a newer format is not included where it
 * arrives, as for a note that does not open.
 */
export class NewerNoteFormatError extends Error {
  constructor(public readonly format: number | null = null) {
    super(
      format === null
        ? "Saved by a newer version of the app"
        : `Saved by a newer version (note format ${format}, this one reads up to ${currentNoteFormat()})`,
    );
    this.name = "NewerNoteFormatError";
  }
}

/**
 * `words`, upgraded from `from` to the current format: the fields that it has
 * go through each step after `from`, and the remaining object stays as it was.
 * A format older than the first (there is none) counts as the first. Thus, a
 * holder that never recorded a format reads as format 1. Throws
 * `NewerNoteFormatError` for a format that is newer than this build knows.
 */
export function upgradeNoteWords<T extends Partial<NoteWords>>(
  words: T,
  from: number,
): T {
  if (isNewerNoteFormat(from)) throw new NewerNoteFormatError(from);
  let out: T = words;
  for (let format = Math.max(from, 1); format <= steps.length; format++) {
    const step = steps[format - 1];
    if (step) out = { ...out, ...step(pickWords(out)) };
  }
  return out;
}

const WORD_FIELDS = [
  "title",
  "content",
  "font",
  "images",
  "imageAlts",
  "linkPreviews",
] as const satisfies readonly (keyof NoteWords)[];

function pickWords(from: Partial<NoteWords>): Partial<NoteWords> {
  const out: Partial<NoteWords> = {};
  for (const field of WORD_FIELDS) {
    if (from[field] !== undefined) Object.assign(out, { [field]: from[field] });
  }
  return out;
}

/** If `changes` include a word of a note. */
export function changesWords(changes: NoteUpdate): boolean {
  return WORD_FIELDS.some((field) => changes[field] !== undefined);
}

/**
 * `changes`, with each word of `note` that they do not include, when they
 * change a word. A write to a note stored in an older format sends this,
 * because the server keeps one format for all words of a note, and refuses a
 * part of them in a newer format. `note` is the note as it was opened, thus
 * already upgraded. Changes that include no word (a pin, the trash) come back
 * as they are.
 */
export function withEveryWord(
  note: NoteWords,
  changes: NoteUpdate,
): NoteUpdate {
  if (!changesWords(changes)) return changes;
  return {
    title: note.title,
    content: note.content,
    font: note.font,
    images: note.images,
    // A new list of images brings its own descriptions, if there are some.
    ...(changes.images === undefined &&
      note.imageAlts !== undefined && { imageAlts: note.imageAlts }),
    linkPreviews: note.linkPreviews,
    ...changes,
  };
}

/**
 * Test seam: the steps that all functions here use. Thus, a test can make the
 * format higher, and see a note upgrade, or a refusal as newer. `null` restores
 * the released steps.
 */
export function setNoteFormatStepsForTests(
  testSteps: readonly NoteFormatStep[] | null,
): void {
  steps = testSteps ?? NOTE_FORMAT_STEPS;
}
