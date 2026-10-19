import type { SessionRevocations } from "#/auth/revocations.ts";
import type { AdminGuardedResult, StorageDriver } from "#/storage/types.ts";
import type { NoteEvents } from "./noteEvents.ts";

/**
 * Deletes an account and all data that belongs to it, whoever asked: an admin
 * from the Users view, or the owner of the account from Settings. The cascade
 * deletes the rows with the user (notes, their versions and images, shares in
 * both directions, sessions, tokens, webhooks, passkeys, keys, preferences).
 * This code must also tell the people at the other end of its shares, and close
 * each socket that is still open on one of its sessions. The audit log keeps
 * its entries about the account until they expire (`AUDIT_RETENTION_DAYS`), as
 * for all accounts.
 *
 * It answers `last-admin`, and does not leave a server with no admin. It
 * answers `not-found` for an account that is already gone. In both cases, it
 * deletes nothing.
 */
export async function deleteAccount(
  deps: {
    storage: StorageDriver;
    noteEvents: NoteEvents;
    revocations: SessionRevocations;
  },
  userId: string,
): Promise<AdminGuardedResult> {
  const { storage, noteEvents, revocations } = deps;
  // Read before the delete. The cascade deletes the shares with the account,
  // and the people at the other end of them must still learn about it.
  const onTheirNotes = await storage.shares.listByOwner(userId);
  const onOthersNotes = await storage.shares.listByRecipient(userId);
  const result = await storage.users.delete(userId);
  if (result !== "ok") return result;
  // The cascade deleted the rows with the user. The code must still end each
  // socket that is open on one of them.
  revocations.revoke({ userId });
  noteEvents.ended(onTheirNotes);
  for (const noteId of new Set(onOthersNotes.map((s) => s.noteId))) {
    await noteEvents.changed(noteId);
  }
  return "ok";
}
