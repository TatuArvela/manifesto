import type { SessionRevocations } from "#/auth/revocations.ts";
import type { AdminGuardedResult, StorageDriver } from "#/storage/types.ts";
import type { NoteEvents } from "./noteEvents.ts";

/**
 * Deletes an account and everything that hangs off it, whoever asked: an
 * admin from the Users view, or the account's owner from Settings. The rows
 * go with the user by cascade (notes, their versions and images, shares
 * both ways, sessions, tokens, webhooks, passkeys, keys, preferences); what
 * is left to do is tell the people on the other end of its shares, and close
 * any socket still open on one of its sessions. The audit log keeps its
 * entries about the account until they expire (`AUDIT_RETENTION_DAYS`), as
 * it does for every account.
 *
 * Answers `last-admin` rather than leave a server with no admin, and
 * `not-found` for an account already gone; nothing is deleted then.
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
  // Read before the delete: the shares go with the account by cascade,
  // and the people on the other end of them still have to hear about it.
  const onTheirNotes = await storage.shares.listByOwner(userId);
  const onOthersNotes = await storage.shares.listByRecipient(userId);
  const result = await storage.users.delete(userId);
  if (result !== "ok") return result;
  // The rows went with the user by cascade; what is left to end is any
  // socket still open on one of them.
  revocations.revoke({ userId });
  noteEvents.ended(onTheirNotes);
  for (const noteId of new Set(onOthersNotes.map((s) => s.noteId))) {
    await noteEvents.changed(noteId);
  }
  return "ok";
}
