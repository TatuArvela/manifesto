import {
  base64urlToBytes,
  bytesToBase64url,
  CIPHERTEXT_PREFIX,
  fromUtf8,
  type LinkPreview,
  type Note,
  NoteColor,
  type NoteCreate,
  NoteFont,
  type NoteUpdate,
  previewImages,
  type SealedNote,
  type SealedNoteCreate,
  type SealedNoteUpdate,
  utf8,
} from "@manifesto/shared";
import { newId } from "../../lib/ulid.js";
import type {
  ClaimedImages,
  StoredNoteCreate,
  StoredNoteUpdate,
} from "../types.js";

// What the server's tests write notes with. The server never opens a note:
// it checks that a sealed field is shaped as a ciphertext and stores it. So a
// test does not need a key, only values of that shape that it can read back,
// which is what `ciphertext` and `plain` are. Real sealing is tested where
// it is done, in `@manifesto/shared` and the client.

/** The nonce and tag of a real ciphertext, as so many zero bytes. */
const FILLER_BYTES = 28;

/** `text` in the shape of a ciphertext. */
export function ciphertext(text: string): string {
  const body = utf8(text);
  const bytes = new Uint8Array(FILLER_BYTES + body.length);
  bytes.set(body, FILLER_BYTES);
  return CIPHERTEXT_PREFIX + bytesToBase64url(bytes);
}

/** What `ciphertext` was given; an empty field, never set, is empty. */
export function plain(sealed: string): string {
  if (sealed === "") return "";
  if (!sealed.startsWith(CIPHERTEXT_PREFIX)) {
    throw new Error(`Not a ciphertext: ${sealed.slice(0, 40)}`);
  }
  const bytes = base64urlToBytes(sealed.slice(CIPHERTEXT_PREFIX.length));
  return fromUtf8(bytes.subarray(FILLER_BYTES)) ?? "";
}

// Storage takes only image references `claimImages` has checked (see
// `ClaimedImages`). A storage test writes rows directly, with references it
// made up or none, so it vouches for them here instead.

export function claimedImages(images: string[] = []): ClaimedImages {
  return images as ClaimedImages;
}

/** A note key as a recipient keeps it, for a test that accepts a share. */
export const heldKey = { key: ciphertext("held key"), keyVersion: 1 };

/** The changes of an update as the app sends them. */
export function sealedUpdate(changes: NoteUpdate): SealedNoteUpdate {
  const { title, content, font, images, linkPreviews, color, tags, ...rest } =
    changes;
  return {
    ...rest,
    ...(title !== undefined && { title: ciphertext(title) }),
    ...(content !== undefined && {
      content: ciphertext(content),
      excerpt: ciphertext(content.slice(0, 140)),
    }),
    ...(font !== undefined && { font: ciphertext(font) }),
    ...(images !== undefined && {
      images: ciphertext(JSON.stringify(images)),
      imageRefs: images,
    }),
    ...(linkPreviews !== undefined && {
      linkPreviews: ciphertext(JSON.stringify(linkPreviews)),
      previewRefs: previewImages(linkPreviews).filter((image) =>
        image.startsWith("attachment:"),
      ),
    }),
    ...(color !== undefined && { color: ciphertext(color) }),
    ...(tags !== undefined && { tags: ciphertext(JSON.stringify(tags)) }),
  };
}

/** A new note as the app sends it, under an id of its own unless given one. */
export function sealedCreate(
  data: NoteCreate,
  id: string = newId(),
): SealedNoteCreate {
  return {
    ...(sealedUpdate(data) as Omit<
      SealedNoteCreate,
      "id" | "key" | "keyVersion"
    >),
    id,
    key: ciphertext(`key of ${id}`),
    keyVersion: 1,
  };
}

/** A note's fields sealed and both lists vouched for, to insert directly. */
export function claimed(data: NoteCreate): StoredNoteCreate {
  // One id for every note's key, so two drivers given the same note store
  // the same row.
  const {
    id: _id,
    imageRefs,
    previewRefs,
    ...sealed
  } = sealedCreate(data, "claimed");
  return {
    ...sealed,
    imageRefs: claimedImages(imageRefs),
    previewRefs: claimedImages(previewRefs),
  };
}

/** The changes of an update sealed and vouched for, to write directly. */
export function claimedUpdate(changes: NoteUpdate): StoredNoteUpdate {
  const { imageRefs, previewRefs, ...sealed } = sealedUpdate(changes);
  return {
    ...sealed,
    ...(imageRefs !== undefined && { imageRefs: claimedImages(imageRefs) }),
    ...(previewRefs !== undefined && {
      previewRefs: claimedImages(previewRefs),
    }),
  };
}

function parsed<T>(sealed: string, fallback: T): T {
  const text = plain(sealed);
  return text === "" ? fallback : (JSON.parse(text) as T);
}

/** A stored note with its fields read back, for a test to look at. */
export function opened(note: SealedNote): Note {
  const {
    key: _key,
    keyVersion: _keyVersion,
    excerpt: _excerpt,
    ...rest
  } = note;
  return {
    ...rest,
    title: plain(note.title),
    content: plain(note.content),
    font: (plain(note.font) || NoteFont.Default) as NoteFont,
    images: parsed<string[]>(note.images, []),
    linkPreviews: parsed<LinkPreview[]>(note.linkPreviews, []),
    color: (plain(note.color) || NoteColor.Default) as NoteColor,
    tags: parsed<string[]>(note.tags, []),
  };
}
