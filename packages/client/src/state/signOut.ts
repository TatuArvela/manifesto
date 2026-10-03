import { deleteLocalNoteCopies } from "../realtime/localNoteCopies.js";
import { logout } from "./auth.js";
import { notes } from "./notesStore.js";
import { removePushSubscription } from "./pushSubscription.js";

/**
 * Sign out and leave none of the account's notes in this browser: the list in
 * memory goes as the session ends (`notesStore.ts`), and this deletes the
 * offline copies of the notes opened for editing. The browser's push
 * subscription goes first, so the account's reminders stop arriving here. A 401 ends the session
 * without this, since it can arrive with offline edits not yet sent.
 */
export async function signOut(): Promise<void> {
  // Read before the session ends, which empties the list.
  const ids = notes.value.map((n) => n.id);
  // While there is still a session to say it with.
  await removePushSubscription();
  await logout();
  await deleteLocalNoteCopies(ids);
}
