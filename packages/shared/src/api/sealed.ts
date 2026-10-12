import type { OfferedKey } from "../crypto/shareSeal.js";
import type { Note } from "../note.js";

// Notes as the server stores them and as a signed-in app sends and receives
// them: every value in someone's words is a ciphertext the server cannot
// open. A token that carries a key is answered with a readable `Note`
// instead. See `docs/specification/features/encryption.md`.

/**
 * A note with its words sealed. What the server acts on stays readable: who
 * holds the note, the pin, archive and trash state, the position, the
 * reminder and the times.
 */
export interface SealedNote
  extends Omit<
    Note,
    | "title"
    | "content"
    | "font"
    | "images"
    | "imageCount"
    | "linkPreviews"
    | "color"
    | "tags"
  > {
  /**
   * The note key, wrapped under the reader's own notes key. Empty for
   * someone the key has not reached yet, who can then open nothing here.
   */
  key: string;
  /** Which note key the values are under; it goes up when the key is
   * replaced. */
  keyVersion: number;
  /**
   * For someone the note is shared with whose own copy of the key is behind:
   * the current key, wrapped to their public key and signed. Their client
   * opens it, keeps it under their own notes key, and reads the note again.
   */
  offered?: OfferedKey;
  // Under the note key, the same for everyone on the note.
  title: string;
  content: string;
  /** The first characters of the text, for a notification to show. */
  excerpt: string;
  font: string;
  /** The note's images, in order. */
  images: string;
  linkPreviews: string;
  // Under the reader's personal key; empty for one never set.
  color: string;
  tags: string;
}

/**
 * The attachments a sealed note uses, which the server has to know to keep
 * them and to let everyone on the note read them. Each list is written with
 * the sealed field it describes and never sent back: a reader takes the
 * images from what it opens.
 */
export interface SealedNoteRefs {
  /** The `attachment:` references inside `images`. */
  imageRefs: string[];
  /** Those of the thumbnails and icons inside `linkPreviews`. */
  previewRefs: string[];
}

/** A new note: the client chooses the id, since every value is bound to it. */
export type SealedNoteCreate = Omit<
  SealedNote,
  "createdAt" | "updatedAt" | "sharing" | "offered"
> &
  SealedNoteRefs;

/** Only the fields being changed. `images` comes with `imageRefs` and
 * `linkPreviews` with `previewRefs`. */
export type SealedNoteUpdate = Partial<
  Omit<SealedNote, "id" | "createdAt" | "sharing" | "offered"> & SealedNoteRefs
>;

/** One note of an import, with the creation time it had where it came from. */
export type SealedNoteImport = SealedNoteCreate & { createdAt?: string };

/**
 * The fields of a sealed note everyone on it shares: `SHARED_NOTE_FIELDS`
 * and the excerpt that is written with the text.
 */
export const SEALED_SHARED_NOTE_FIELDS = [
  "title",
  "content",
  "excerpt",
  "font",
  "images",
  "imageRefs",
  "linkPreviews",
  "previewRefs",
] as const;

/** A version of a note's title and text, sealed under the note key it was
 * written with. */
export interface SealedNoteVersion {
  /** Chosen by the client: the values are bound to it. */
  id: string;
  noteId: string;
  timestamp: string;
  keyVersion: number;
  title: string;
  content: string;
}

/** `POST /api/notes/:id/versions` from the app. */
export interface SealedNoteVersionCreateRequest {
  id: string;
  keyVersion: number;
  title: string;
  content: string;
  timestamp?: string;
}

/** An account's preferences as the server holds them: each value sealed
 * under the account's personal key. */
export type SealedAccountPrefs = Record<string, string>;

/** `PATCH /api/auth/me/prefs`: the keys to set, `null` removing one. */
export interface SealedAccountPrefsUpdate {
  prefs: Record<string, string | null>;
}

/** `GET /api/auth/me/prefs`, and the answer to a `PATCH`. */
export interface SealedAccountPrefsResponse {
  prefs: SealedAccountPrefs;
}
