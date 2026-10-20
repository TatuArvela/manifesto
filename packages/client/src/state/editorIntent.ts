import { editingNoteId } from "./ui.ts";

/**
 * What a card asked its editor to do when it opens: show the version history,
 * or attach pictures selected (or drawn) from the card. The card has neither
 * the history panel nor the upload pipeline. A second build of either is how
 * the three menus became different before. Thus, it opens the editor, and
 * leaves the work to it.
 */
export type EditorIntent =
  | { kind: "versions" }
  | { kind: "attach"; files: File[] };

let pending: { noteId: string; intent: EditorIntent } | null = null;

/** Opens the editor of the note, which then does `intent`. */
export function openNoteWith(noteId: string, intent: EditorIntent): void {
  pending = { noteId, intent };
  editingNoteId.value = noteId;
}

/**
 * The intent that waits for the editor of this note, taken so that it runs one
 * time. A note that opens again later opens plainly. The code drops an intent
 * for a different note, because the editor for which it was never opened.
 */
export function takeEditorIntent(noteId: string): EditorIntent | null {
  const taken = pending;
  pending = null;
  return taken?.noteId === noteId ? taken.intent : null;
}
