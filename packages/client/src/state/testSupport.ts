import type { Note, NoteCreate } from "@manifesto/shared";
import { createNote } from "./actions.js";

/**
 * `createNote` resolves `null` rather than rejecting when storage fails; see
 * the contract at the top of `actions.ts`. Tests that are about what happens
 * *after* a note exists say so with this, instead of asserting non-null at
 * every call site.
 *
 * Not a `.test.ts` file, so Vitest does not collect it.
 */
export async function createNoteOrFail(
  input: Partial<NoteCreate> = {},
): Promise<Note> {
  const note = await createNote(input);
  if (!note) throw new Error("createNote failed in a test that assumed it not");
  return note;
}
