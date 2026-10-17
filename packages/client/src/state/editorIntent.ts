import { editingNoteId } from "./ui.ts";

/**
 * What a card asked its editor to do as it opens: show the version history,
 * or attach pictures picked (or drawn) from the card. The card has neither the
 * history panel nor the upload pipeline, and building either a second time is
 * how the three menus drifted apart before, so it opens the editor and leaves
 * the work to it.
 */
export type EditorIntent =
  | { kind: "versions" }
  | { kind: "attach"; files: File[] };

let pending: { noteId: string; intent: EditorIntent } | null = null;

/** Opens the note's editor, which then carries out `intent`. */
export function openNoteWith(noteId: string, intent: EditorIntent): void {
  pending = { noteId, intent };
  editingNoteId.value = noteId;
}

/**
 * The intent waiting for this note's editor, taken so that it runs once: a
 * note opened again later opens plainly. One for another note is dropped, as
 * the editor it was meant for never opened.
 */
export function takeEditorIntent(noteId: string): EditorIntent | null {
  const taken = pending;
  pending = null;
  return taken?.noteId === noteId ? taken.intent : null;
}
