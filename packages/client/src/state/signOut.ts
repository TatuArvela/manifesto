import { deleteLocalNoteCopies } from "../realtime/localNoteCopies.js";
import {
  clearAuthLocal,
  type DeleteAccountResult,
  logout,
  requestAccountDeletion,
} from "./auth.js";
import { notes } from "./notesStore.js";
import {
  dropBrowserPushSubscription,
  removePushSubscription,
} from "./pushSubscription.js";

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

/**
 * Delete the signed-in account, then leave this browser as a sign-out does.
 * The server has already dropped the session and the push subscription with
 * the account, so there is nobody left to tell; only the browser's own
 * copies go.
 */
export async function deleteOwnAccount(
  password: string,
): Promise<DeleteAccountResult> {
  const ids = notes.value.map((n) => n.id);
  const result = await requestAccountDeletion(password);
  if (result !== "ok") return result;
  clearAuthLocal();
  await dropBrowserPushSubscription();
  await deleteLocalNoteCopies(ids);
  return "ok";
}
