import { deleteLocalNoteCopies } from "../realtime/localNoteCopies.js";
import { logout } from "./auth.js";
import { notes } from "./notesStore.js";

/**
 * Sign out and leave none of the account's notes in this browser: the list in
 * memory goes as the session ends (`notesStore.ts`), and this deletes the
 * offline copies of the notes opened for editing. A 401 ends the session
 * without this, since it can arrive with offline edits not yet sent.
 */
export async function signOut(): Promise<void> {
  // Read before the session ends, which empties the list.
  const ids = notes.value.map((n) => n.id);
  await logout();
  await deleteLocalNoteCopies(ids);
}
