import { deleteLocalNoteCopies } from "#/realtime/localNoteCopies.ts";
import { notes } from "#/state/notesStore.ts";
import {
  dropBrowserPushSubscription,
  removePushSubscription,
} from "#/state/pushSubscription.ts";
import { dropAllOffline } from "#/storage/offlineNotes.ts";
import {
  clearAuthLocal,
  currentUser,
  type DeleteAccountResult,
  logout,
  requestAccountDeletion,
} from "./auth.ts";

/**
 * Sign out, and leave none of the notes of the account in this browser. The
 * list in memory goes when the session ends (`notesStore.ts`). This deletes the
 * offline copies of the notes opened for editing, the draft of the composer and
 * the notes not sent yet (`storage/offlineNotes.ts`). The push subscription of
 * the browser goes first. Thus, the reminders of the account stop to arrive
 * here. A 401 ends the session without this, because it can arrive with offline
 * edits that were not sent yet.
 */
export async function signOut(): Promise<void> {
  // Read before the session ends, which empties the list.
  const ids = notes.value.map((n) => n.id);
  const userId = currentUser.peek()?.id;
  // While there is still a session with which to tell it.
  await removePushSubscription();
  await logout();
  await deleteLocalNoteCopies(ids);
  if (userId !== undefined) await dropAllOffline(userId);
}

/**
 * Delete the signed-in account, then leave this browser as a sign-out does. The
 * server already dropped the session and the push subscription with the
 * account. Thus, there is nobody left to tell. Only the own copies of the
 * browser go.
 */
export async function deleteOwnAccount(
  password: string,
): Promise<DeleteAccountResult> {
  const ids = notes.value.map((n) => n.id);
  const userId = currentUser.peek()?.id;
  const result = await requestAccountDeletion(password);
  if (result !== "ok") return result;
  clearAuthLocal();
  await dropBrowserPushSubscription();
  await deleteLocalNoteCopies(ids);
  if (userId !== undefined) await dropAllOffline(userId);
  return "ok";
}
