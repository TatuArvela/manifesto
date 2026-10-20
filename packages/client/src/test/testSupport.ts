import type { Note, NoteCreate } from "@manifesto/shared";
import { createNote } from "#/state/notesStore.ts";

/**
 * `createNote` resolves `null`, and does not reject, when storage fails. See
 * the contract at the top of `actions.ts`. Tests about what occurs *after* a
 * note exists say so with this, and do not assert non-null at each call site.
 *
 * Not a `.test.ts` file. Thus, Vitest does not collect it.
 */
export async function createNoteOrFail(
  input: Partial<NoteCreate> = {},
): Promise<Note> {
  const note = await createNote(input);
  if (!note) throw new Error("createNote failed in a test that assumed it not");
  return note;
}
