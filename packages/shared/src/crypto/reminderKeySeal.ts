import { wipe } from "./bytes.js";
import {
  type AccountSealKeys,
  type NoteSealKey,
  noteSealKey,
} from "./noteSeal.js";
import { associatedData, seal, unseal } from "./seal.js";

// A note's key as a calendar feed opens it, kept apart from the rest of a
// note's sealing (`noteSeal.ts`) for length alone.

/** Whose reminder key it is: the account, and its account key's version. */
type ReminderOwner = Pick<AccountSealKeys, "userId" | "version">;

function reminderKeyData(
  owner: ReminderOwner,
  noteId: string,
  keyVersion: number,
): Uint8Array<ArrayBuffer> {
  return associatedData({
    id: noteId,
    field: `reminder-key/${keyVersion}`,
    version: owner.version,
    account: owner.userId,
  });
}

/**
 * A note's key wrapped under its holder's reminder key, for a note with a
 * reminder: the one copy a calendar feed can open, so a feed reaches the
 * notes that have a reminder and no others.
 */
export function wrapForReminders(
  reminders: CryptoKey,
  owner: ReminderOwner,
  noteId: string,
  keyVersion: number,
  raw: Uint8Array<ArrayBuffer>,
): Promise<string> {
  return seal(reminders, raw, reminderKeyData(owner, noteId, keyVersion));
}

/** The note key a feed opens a note with; null when the copy does not open
 * or is for another key than the note is under. */
export async function openReminderKey(
  reminders: CryptoKey,
  owner: ReminderOwner,
  noteId: string,
  keyVersion: number,
  wrapped: string | undefined,
): Promise<NoteSealKey | null> {
  if (!wrapped) return null;
  const raw = await unseal(
    reminders,
    wrapped,
    reminderKeyData(owner, noteId, keyVersion),
  );
  if (!raw) return null;
  try {
    return await noteSealKey(raw, keyVersion);
  } finally {
    wipe(raw);
  }
}
