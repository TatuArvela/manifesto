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
 * A note's keys (`docs/specification/features/encryption.md`, "Keys"): the
 * note key, stored wrapped under its holder's notes key (and under their
 * reminder key for a calendar feed), the keys it was under before, and an
 * uploaded image's key until a note names the image.
 * What is sealed under them is `noteSeal.ts`.
 */

/** The keys of an account that a note is sealed and opened with. */
export interface AccountSealKeys {
  userId: string;
  /** The version of the account key these come from. */
  version: number;
  /** Wraps note keys. */
  notes: CryptoKey;
  /** Seals what is one person's own. */
  personal: CryptoKey;
}

/**
 * A note's key, ready to use and not readable: a key for each job, derived
 * from the note key. Edits and cursor states are many, so each has a key of
 * its own, apart from the one that seals the note's fields: random nonces are
 * safe for about 2^32 messages under one key. Those two are derived the
 * first time they are asked for: every note of a listing is opened, and only
 * the one whose editor opens needs them.
 */
export interface NoteSealKey {
  version: number;
  /** Seals the note's fields, its versions and its comments. */
  fields: CryptoKey;
  /** Seals the edits and snapshots of its shared document. */
  edits(): Promise<CryptoKey>;
  /** Seals the cursor states of the people editing it. */
  presence(): Promise<CryptoKey>;
}

const NOTE_KEY_BYTES = 32;

/** What a value everyone on a note sees is bound to: the row and the field,
 * under this version of the note key. */
export function sharedData(key: NoteSealKey, rowId: string, field: string) {
  return associatedData({ id: rowId, field, version: key.version });
}

/** What a value of one person's own is bound to: the row, the field and the
 * account, under this version of the account key. */
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

/** 256 random bits for a new note. The caller wipes them once wrapped. */
export function newNoteKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(NOTE_KEY_BYTES));
}

/** The key that seals a note's fields, from the note key's bytes. */
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

/** The note key's bytes, for wrapping to someone else; null when `wrapped`
 * does not open. The caller wipes them. */
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

/** The key of a note as its holder uses it; null when it does not open. */
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

function previousKeysData(key: NoteSealKey, noteId: string) {
  return sharedData(key, noteId, "previous-keys");
}

/**
 * How many earlier keys a note carries. The list grows by one with every
 * replacement and the server holds it to a length, so past this many the
 * oldest go: what was written under them (a version, a comment from that
 * long ago) stops opening, which is the lesser loss beside a note that can
 * no longer leave a key someone removed still holds.
 */
export const MAX_PREVIOUS_KEYS = 1024;

/** The longest a note's sealed list of earlier keys may be: each is a
 * version and 32 bytes in base64, well under 64 bytes of JSON. */
export const MAX_PREVIOUS_KEYS_LENGTH = sealedLength(MAX_PREVIOUS_KEYS * 64);

/**
 * The keys a note was under before, by version, sealed under the key it is
 * under now, so that whoever holds the note still opens what was written
 * under them. Someone removed held those keys already; they are never given
 * the new one. Only the newest `MAX_PREVIOUS_KEYS` are kept.
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

/** A note's earlier keys, raw, by version. Empty when there are none or
 * they do not open. The caller wipes them. */
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
 * An uploaded image's key, kept for its uploader until a note names the
 * image: wrapped under their notes key and bound to the attachment. Only a
 * token's upload needs it, since the server holds nothing between two
 * requests; the app keeps the key in memory.
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

/** The key `wrapImageKey` kept; null when it does not open for this account. */
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
