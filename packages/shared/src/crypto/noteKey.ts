import { base64urlToBytes, bytesToBase64url, utf8, wipe } from "./bytes.ts";
import { type ImageKey, isImageKey } from "./imageSeal.ts";
import {
  associatedData,
  derivable,
  deriveKey,
  seal,
  sealedLength,
  unseal,
  unsealText,
} from "./seal.ts";

/**
 * The keys of a note (`docs/specification/features/encryption.md`, "Keys"): the
 * note key, stored wrapped under the notes key of its holder (and under their
 * reminder key for a calendar feed), its previous keys, and the key of an
 * uploaded image until a note names the image. `noteSeal.ts` seals the values
 * under them.
 */

/** The keys of an account with which a note is sealed and opened. */
export interface AccountSealKeys {
  userId: string;
  /** The version of the account key from which these come. */
  version: number;
  /** Wraps note keys. */
  notes: CryptoKey;
  /** Seals the data of one person. */
  personal: CryptoKey;
}

/**
 * The key of a note, ready for use and not readable: one key for each job,
 * derived from the note key. There are many edits and cursor states. Thus, each
 * has its own key, separate from the key that seals the fields of the note.
 * Random nonces are safe for approximately 2^32 messages under one key. Those
 * two keys are derived the first time that code asks for them. The app opens
 * each note of a listing, and only the note whose editor opens needs them.
 */
export interface NoteSealKey {
  version: number;
  /** Seals the fields, the versions and the comments of the note. */
  fields: CryptoKey;
  /** Seals the edits and snapshots of its shared document. */
  edits(): Promise<CryptoKey>;
  /** Seals the cursor states of the persons who edit it. */
  presence(): Promise<CryptoKey>;
}

const NOTE_KEY_BYTES = 32;

/**
 * What a value that all persons on a note see is bound to: the row and the
 * field, under this version of the note key.
 */
export function sharedData(key: NoteSealKey, rowId: string, field: string) {
  return associatedData({ id: rowId, field, version: key.version });
}

/**
 * What a value of one person is bound to: the row, the field and the account,
 * under this version of the account key.
 */
export function personalData(
  account: AccountSealKeys,
  rowId: string,
  field: string,
) {
  return associatedData({
    id: rowId,
    field,
    version: account.version,
    account: account.userId,
  });
}

/** 256 random bits for a new note. The caller wipes them after the wrap. */
export function newNoteKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(NOTE_KEY_BYTES));
}

/** The key that seals the fields of a note, from the bytes of the note key. */
export async function noteSealKey(
  raw: Uint8Array<ArrayBuffer>,
  version: number,
): Promise<NoteSealKey> {
  const base = await derivable(raw);
  let edits: Promise<CryptoKey> | undefined;
  let presence: Promise<CryptoKey> | undefined;
  return {
    version,
    fields: await deriveKey(base, "note/fields"),
    edits: () => {
      edits ??= deriveKey(base, "note/edits");
      return edits;
    },
    presence: () => {
      presence ??= deriveKey(base, "note/presence");
      return presence;
    },
  };
}

function noteKeyData(
  account: AccountSealKeys,
  noteId: string,
  keyVersion: number,
): Uint8Array<ArrayBuffer> {
  return personalData(account, noteId, `note-key/${keyVersion}`);
}

/** The note key as its holder stores it: under their notes key. */
export function wrapNoteKey(
  account: AccountSealKeys,
  noteId: string,
  keyVersion: number,
  raw: Uint8Array<ArrayBuffer>,
): Promise<string> {
  return seal(account.notes, raw, noteKeyData(account, noteId, keyVersion));
}

/**
 * The bytes of the note key, to wrap for a different person. Null when
 * `wrapped` does not open. The caller wipes them.
 */
export function unwrapNoteKey(
  account: AccountSealKeys,
  noteId: string,
  keyVersion: number,
  wrapped: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  return unseal(
    account.notes,
    wrapped,
    noteKeyData(account, noteId, keyVersion),
  );
}

/** The key of a note as its holder uses it. Null when it does not open. */
export async function openNoteKey(
  account: AccountSealKeys,
  noteId: string,
  keyVersion: number,
  wrapped: string,
): Promise<NoteSealKey | null> {
  const raw = await unwrapNoteKey(account, noteId, keyVersion, wrapped);
  if (!raw) return null;
  try {
    return await noteSealKey(raw, keyVersion);
  } finally {
    wipe(raw);
  }
}

/**
 * The owner of the reminder key: the account, and the version of its account
 * key.
 */
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
 * The key of a note wrapped under the reminder key of its holder, for a note
 * with a reminder. This is the only copy that a calendar feed can open. Thus, a
 * feed reaches the notes that have a reminder, and no other notes.
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

/**
 * The note key with which a feed opens a note. Null when the copy does not
 * open, or is for a different key than the current key of the note.
 */
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

function previousKeysData(key: NoteSealKey, noteId: string) {
  return sharedData(key, noteId, "previous-keys");
}

/**
 * The number of previous keys that a note keeps. The list grows by one with
 * each replacement, and the server limits its length. Thus, after this many,
 * the oldest keys go. What was written under them (a version, a comment from
 * that time) stops to open. That is a smaller loss than a note that cannot
 * leave a key that a removed person still has.
 */
export const MAX_PREVIOUS_KEYS = 1024;

/**
 * The maximum length of the sealed list of previous keys of a note. Each one is
 * a version and 32 bytes in base64, much less than 64 bytes of JSON.
 */
export const MAX_PREVIOUS_KEYS_LENGTH = sealedLength(MAX_PREVIOUS_KEYS * 64);

/**
 * The previous keys of a note, by version, sealed under its current key. Thus,
 * each holder of the note can still open what was written under them. A removed
 * person had those keys already. They never get the new key. Only the newest
 * `MAX_PREVIOUS_KEYS` are kept.
 */
export async function sealPreviousKeys(
  key: NoteSealKey,
  noteId: string,
  previous: ReadonlyMap<number, Uint8Array<ArrayBuffer>>,
): Promise<string> {
  const listed: Record<string, string> = {};
  const newest = [...previous]
    .sort(([a], [b]) => b - a)
    .slice(0, MAX_PREVIOUS_KEYS);
  for (const [version, raw] of newest) {
    listed[String(version)] = bytesToBase64url(raw);
  }
  return seal(
    key.fields,
    utf8(JSON.stringify(listed)),
    previousKeysData(key, noteId),
  );
}

/**
 * The previous keys of a note, raw, by version. Empty when there are none, or
 * when they do not open. The caller wipes them.
 */
export async function openPreviousKeys(
  key: NoteSealKey,
  noteId: string,
  sealed: string | undefined,
): Promise<Map<number, Uint8Array<ArrayBuffer>>> {
  const out = new Map<number, Uint8Array<ArrayBuffer>>();
  const text = await unsealText(
    key.fields,
    sealed,
    previousKeysData(key, noteId),
  );
  if (text === null) return out;
  try {
    const listed = JSON.parse(text) as Record<string, unknown>;
    for (const [name, value] of Object.entries(listed)) {
      const version = Number(name);
      if (!Number.isInteger(version) || version < 1 || version >= key.version) {
        continue;
      }
      if (typeof value !== "string") continue;
      const raw = base64urlToBytes(value);
      if (raw.length === NOTE_KEY_BYTES) out.set(version, raw);
    }
  } catch {
    out.clear();
  }
  return out;
}

function imageKeyData(account: AccountSealKeys, attachmentId: string) {
  return personalData(account, attachmentId, "attachment-key");
}

/**
 * The key of an uploaded image, kept for its uploader until a note names the
 * image: wrapped under their notes key, and bound to the attachment. Only the
 * upload of a token needs it, because the server keeps nothing between two
 * requests. The app keeps the key in memory.
 */
export function wrapImageKey(
  account: AccountSealKeys,
  attachmentId: string,
  key: ImageKey,
): Promise<string> {
  return seal(
    account.notes,
    utf8(JSON.stringify(key)),
    imageKeyData(account, attachmentId),
  );
}

/**
 * The key that `wrapImageKey` kept. Null when it does not open for this
 * account.
 */
export async function unwrapImageKey(
  account: AccountSealKeys,
  attachmentId: string,
  wrapped: string | null | undefined,
): Promise<ImageKey | null> {
  const text = await unsealText(
    account.notes,
    wrapped,
    imageKeyData(account, attachmentId),
  );
  if (text === null) return null;
  try {
    const key: unknown = JSON.parse(text);
    return isImageKey(key) ? key : null;
  } catch {
    return null;
  }
}
