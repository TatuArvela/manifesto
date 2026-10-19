import type { Note, NoteUpdate } from "#/note.ts";

/**
 * What a note's words mean, as a number that goes up
 * (`docs/specification/data-model.md`, "Format").
 *
 * The app only ever holds a note in the current format. Every place a note
 * is kept records the format it was written in (the open-mode store, a
 * sealed note and its versions, a public link's copy, an export, a note
 * waiting on the device), and whatever reads one from there brings it up to
 * date with the steps below before anything else sees it. A note in a format
 * newer than this build knows is never shown as if it were understood, and
 * never written over: an older tab or an old cached build has to be reloaded
 * first.
 *
 * Format 1 is every note as it was when formats began to be recorded. A
 * change to what a note's words hold (a new way of writing something in the
 * text, a field of an image's entry read differently) is a new step at the
 * end of `NOTE_FORMAT_STEPS`, which raises the format by one, and never an
 * edit to a step already released: a stored note remembers which steps it
 * has had.
 */

/** The part of a note its format describes. A version keeps only the title
 * and text, and a public link's copy has no colour or tags, so a step gets
 * whichever of these the holder has. */
export type NoteWords = Pick<
  Note,
  "title" | "content" | "font" | "images" | "imageAlts" | "linkPreviews"
>;

/**
 * One step, from the format before it to its own. It changes the fields it is
 * given and adds none: a version handed in with its title and text alone
 * comes out with only those.
 */
export type NoteFormatStep = (words: Partial<NoteWords>) => Partial<NoteWords>;

/** Step `i` takes a note from format `i + 1` to `i + 2`. */
export const NOTE_FORMAT_STEPS: readonly NoteFormatStep[] = [];

let steps: readonly NoteFormatStep[] = NOTE_FORMAT_STEPS;

/** The format this build writes, and the newest it can read. */
export function currentNoteFormat(): number {
  return steps.length + 1;
}

/** Whether a note kept in `format` was written by a newer build than this. */
export function isNewerNoteFormat(format: number): boolean {
  return format > currentNoteFormat();
}

/**
 * Raised where a note kept in a newer format would otherwise be read as this
 * build understands it, or written over: the open-mode store, an export, and
 * a write the server refused for it (`note_format_newer`), which does not say
 * the format. A sealed note in one is left out where it arrives instead, as
 * one that does not open is.
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
 * `words` brought from `from` up to the current format: the fields it has
 * passed through every step after `from`, and the rest of the object as it
 * was. A format older than the first (none is) is taken as the first, so a
 * holder that never recorded one reads as format 1. Throws
 * `NewerNoteFormatError` for a format newer than this build knows.
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

/** Whether `changes` touch any of a note's words. */
export function changesWords(changes: NoteUpdate): boolean {
  return WORD_FIELDS.some((field) => changes[field] !== undefined);
}

/**
 * `changes` with every word of `note` they leave out, when they change any:
 * what a write to a note stored in an older format sends, since the server
 * keeps one format for all of a note's words and refuses part of them in a
 * newer one. `note` is the note as opened, so already upgraded. Changes that
 * touch no word (a pin, the trash) are handed back as they are.
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
    // A new list of images brings its own descriptions, if any.
    ...(changes.images === undefined &&
      note.imageAlts !== undefined && { imageAlts: note.imageAlts }),
    linkPreviews: note.linkPreviews,
    ...changes,
  };
}

/**
 * Test seam: the steps every function here uses, so a test can raise the
 * format and watch a note be upgraded, or refused as newer. `null` puts back
 * the released ones.
 */
export function setNoteFormatStepsForTests(
  testSteps: readonly NoteFormatStep[] | null,
): void {
  steps = testSteps ?? NOTE_FORMAT_STEPS;
}
