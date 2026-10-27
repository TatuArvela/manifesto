import type { OfferedKey } from "#/crypto/shareSeal.ts";
import { type Note, PERSONAL_NOTE_FIELDS } from "#/note.ts";

// Notes as the server stores them, and as a signed-in app sends and gets them.
// Each value in the words of a person is a ciphertext that the server cannot
// open. A token that carries a key gets a readable `Note`. See
// `docs/specification/features/encryption.md`.

/**
 * A note with its words sealed. The values on which the server acts stay
 * readable: who has the note, the pin, archive and trash state, the position,
 * the reminder and the times.
 */
export interface SealedNote
  extends Omit<
    Note,
    | "title"
    | "content"
    | "font"
    | "images"
    | "imageAlts"
    | "imageCount"
    | "linkPreviews"
    | "color"
    | "tags"
  > {
  /**
   * The note key, wrapped under the own notes key of the reader. Empty for a
   * person whom the key did not reach yet. That person can open nothing here.
   */
  key: string;
  /**
   * The note key under which the values are. It increases when the key is
   * replaced.
   */
  keyVersion: number;
  /**
   * The format of the words under the note key (`noteFormat.ts`). It is
   * readable, because a client must know before it opens them if it can read
   * them. The server checks each write against it.
   */
  format: number;
  /**
   * For a person who shares the note and whose own copy of the key is behind:
   * the current key, wrapped to their public key and signed. Their client opens
   * it, keeps it under their own notes key, and reads the note again.
   */
  offered?: OfferedKey;
  /**
   * While the note has a reminder: its key wrapped under the own reminder key
   * of the reader. A calendar feed opens the note with it. The client that sets
   * the reminder writes it. It goes when the reminder goes, or when the key of
   * the note is replaced. Absent when there is none.
   */
  reminderKey?: string;
  /**
   * The previous keys of the note, sealed under its current key. These still
   * open its older versions, comments and edits. Absent for a note whose key
   * was never replaced.
   */
  previousKeys?: string;
  /**
   * For the owner: a person who had the key does not have the note now. Thus,
   * the app of the owner must give it a new key (`PUT /api/v1/notes/:id/key`).
   */
  rekeyDue?: true;
  // Under the note key, the same for all persons on the note.
  title: string;
  content: string;
  /** The first characters of the text, for a notification. */
  excerpt: string;
  font: string;
  /** The images of the note, in order, each with its description. */
  images: string;
  linkPreviews: string;
  // Under the personal key of the reader. Empty if never set.
  color: string;
  tags: string;
}

/**
 * The attachments that a sealed note uses. The server must know them, to keep
 * them and to let all persons on the note read them. Each list is written with
 * the sealed field that it describes, and never sent back. A reader gets the
 * images from what it opens.
 */
export interface SealedNoteRefs {
  /** The `attachment:` references inside `images`. */
  imageRefs: string[];
  /** The references of the thumbnails and icons inside `linkPreviews`. */
  previewRefs: string[];
}

/** A new note. The client selects the id, because each value is bound to it. */
export type SealedNoteCreate = Omit<
  SealedNote,
  | "createdAt"
  | "updatedAt"
  | "sharing"
  | "offered"
  | "previousKeys"
  | "rekeyDue"
> &
  SealedNoteRefs;

/**
 * Only the fields that change. `images` comes with `imageRefs`, and
 * `linkPreviews` with `previewRefs`.
 */
export type SealedNoteUpdate = Partial<
  Omit<
    SealedNote,
    "id" | "createdAt" | "sharing" | "offered" | "previousKeys" | "rekeyDue"
  > &
    SealedNoteRefs
>;

/**
 * `PUT /api/v1/notes/:id/key` from the app of the owner: the note under a new
 * key. All values that the persons on the note share are sealed again. The key
 * comes wrapped for the owner, with the previous keys sealed under it.
 * `keyVersion` is one more than that of the note. Each named live public link
 * gets the new key wrapped by its link key. A link that is not named stops to
 * open.
 */
export interface NoteRekeyRequest {
  keyVersion: number;
  key: string;
  previousKeys: string;
  title: string;
  content: string;
  excerpt: string;
  font: string;
  images: string;
  linkPreviews: string;
  links?: { token: string; wrappedKey: string }[];
}

/** One note of an import, with the creation time from its source. */
export type SealedNoteImport = SealedNoteCreate & { createdAt?: string };

/**
 * The fields of a sealed note that all persons on it share:
 * `SHARED_NOTE_FIELDS`, the excerpt that is written with the text, and their
 * format.
 */
export const SEALED_SHARED_NOTE_FIELDS = [
  "format",
  "title",
  "content",
  "excerpt",
  "font",
  "images",
  "imageRefs",
  "linkPreviews",
  "previewRefs",
] as const;

/**
 * The fields of a sealed note that belong to each reader:
 * `PERSONAL_NOTE_FIELDS`, and the copy of the note key that their calendar feed
 * opens, which goes with their reminder.
 */
export const SEALED_PERSONAL_NOTE_FIELDS = [
  ...PERSONAL_NOTE_FIELDS,
  "reminderKey",
] as const;

/**
 * A version of the title and text of a note, sealed under the note key with
 * which it was written.
 */
export interface SealedNoteVersion {
  /** The client selects it. The values are bound to it. */
  id: string;
  noteId: string;
  timestamp: string;
  keyVersion: number;
  /** The format of its title and text, as for a note. */
  format: number;
  title: string;
  content: string;
  /** The image list, sealed as that of a note. Absent on an older version. */
  images?: string;
}

/**
 * `POST /api/v1/notes/:id/versions` from the app. `images` comes with
 * `imageRefs`, as on a note write. Thus, the server knows which attachments the
 * version keeps.
 */
export interface SealedNoteVersionCreateRequest {
  id: string;
  keyVersion: number;
  format: number;
  title: string;
  content: string;
  images?: string;
  imageRefs?: string[];
  timestamp?: string;
}

/**
 * The preferences of an account as the server keeps them: each value sealed
 * under the personal key of the account.
 */
export type SealedAccountPrefs = Record<string, string>;

/** `PATCH /api/v1/auth/me/prefs`: the keys to set. `null` removes one. */
export interface SealedAccountPrefsUpdate {
  prefs: Record<string, string | null>;
}

/** `GET /api/v1/auth/me/prefs`, and the answer to a `PATCH`. */
export interface SealedAccountPrefsResponse {
  prefs: SealedAccountPrefs;
}
