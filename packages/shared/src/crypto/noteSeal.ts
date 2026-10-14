import { MAX_COMMENT_LENGTH } from "../api/comments.js";
import { MAX_ACCOUNT_PREFS_BYTES } from "../api/prefs.js";
import type {
  SealedNote,
  SealedNoteCreate,
  SealedNoteRefs,
  SealedNoteUpdate,
  SealedNoteVersion,
} from "../api/sealed.js";
import {
  ATTACHMENT_REF_PREFIX,
  attachmentIdOf,
  isAttachmentRef,
  type LinkPreview,
  MAX_IMAGES_PER_NOTE,
  MAX_LINK_PREVIEW_DESCRIPTION_LENGTH,
  MAX_LINK_PREVIEW_TITLE_LENGTH,
  MAX_LINK_PREVIEW_URL_LENGTH,
  MAX_LINK_PREVIEWS_PER_NOTE,
  MAX_NOTE_CONTENT_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_NOTE,
  NOTE_EXCERPT_LENGTH,
  type Note,
  NoteColor,
  type NoteCreate,
  NoteFont,
  type NoteUpdate,
  type NoteVersion,
} from "../note.js";
import {
  base64urlToBytes,
  bytesToBase64url,
  fromUtf8,
  utf8,
  wipe,
} from "./bytes.js";
import { type ImageKey, isImageKey } from "./imageSeal.js";
import {
  associatedData,
  derivable,
  deriveKey,
  seal,
  sealedLength,
  unseal,
} from "./seal.js";

/**
 * A note's words, sealed and opened
 * (`docs/specification/features/encryption.md`, "Keys").
 *
 * What everyone on a note sees (title, text, excerpt, font, link previews)
 * is under the note key. What is one person's own (colour, tags) is under
 * their personal key. The note key is stored wrapped under its holder's notes
 * key. Both sides of a readable request use this: the browser always, and
 * the server for a token that carries a key.
 *
 * What is opened was written by some client and checked by no server, so
 * every value is checked here before it is handed on, and one that fails is
 * left out.
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

/** Colours and fonts are few, and the length of a ciphertext would name the
 * one inside, so each is padded to this many characters. */
const PADDED_LENGTH = 24;

/** The most a note's link previews may take, as JSON. */
const MAX_LINK_PREVIEWS_BYTES = 300_000;

/**
 * The longest ciphertext each sealed field may be. The server holds a field
 * to this and to the shape of a ciphertext, which is all it can check. A
 * UTF-16 unit is at most three bytes of UTF-8, and six once JSON has escaped
 * it.
 */
export const SEALED_FIELD_MAX = {
  title: sealedLength(MAX_NOTE_TITLE_LENGTH * 3),
  content: sealedLength(MAX_NOTE_CONTENT_LENGTH * 3),
  excerpt: sealedLength(NOTE_EXCERPT_LENGTH * 4),
  font: sealedLength(PADDED_LENGTH),
  images: sealedLength(MAX_IMAGES_PER_NOTE * 256),
  color: sealedLength(PADDED_LENGTH),
  tags: sealedLength(MAX_TAGS_PER_NOTE * (MAX_TAG_LENGTH * 6 + 3) + 2),
  linkPreviews: sealedLength(MAX_LINK_PREVIEWS_BYTES),
  pref: sealedLength(MAX_ACCOUNT_PREFS_BYTES),
  comment: sealedLength(MAX_COMMENT_LENGTH * 3),
} as const;

/** A value the client refuses to seal, as the server once refused to store
 * it. */
export class NoteLimitError extends Error {
  constructor(public readonly field: string) {
    super(`The note's ${field} is past what a note may hold`);
    this.name = "NoteLimitError";
  }
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
  return associatedData({
    id: noteId,
    field: `note-key/${keyVersion}`,
    version: account.version,
    account: account.userId,
  });
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

/** The first characters of a note's text, whole ones. */
export function excerptOf(content: string): string {
  return Array.from(content.slice(0, NOTE_EXCERPT_LENGTH * 2))
    .slice(0, NOTE_EXCERPT_LENGTH)
    .join("");
}

type SharedPlain = Pick<
  Note,
  "title" | "content" | "font" | "images" | "linkPreviews"
>;
type PersonalPlain = Pick<Note, "color" | "tags">;
export type SharedSealed = Pick<
  SealedNote,
  "title" | "content" | "excerpt" | "font" | "images" | "linkPreviews"
>;
type PersonalSealed = Pick<SealedNote, "color" | "tags">;

function sharedData(key: NoteSealKey, noteId: string, field: string) {
  return associatedData({ id: noteId, field, version: key.version });
}

function personalData(account: AccountSealKeys, id: string, field: string) {
  return associatedData({
    id,
    field,
    version: account.version,
    account: account.userId,
  });
}

const colors = new Set<string>(Object.values(NoteColor));
const fonts = new Set<string>(Object.values(NoteFont));

function isHttpUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_LINK_PREVIEW_URL_LENGTH &&
    /^https?:\/\//i.test(value) &&
    URL.canParse(value)
  );
}

/**
 * Link previews as a note may hold them, from anything: each card checked
 * as the server checked one, a card that fails left out, and an image that
 * is not an attachment dropped from its card.
 *
 * The card shows `domain` as where the link goes, so it is always the URL's
 * own host, whatever was sealed: a writer could otherwise have a card name
 * one site and open another, on a shared note or a public link, and the
 * server cannot look inside to put it right.
 */
export function checkedLinkPreviews(
  raw: unknown,
  found?: Map<string, ImageKey>,
): LinkPreview[] {
  if (!Array.isArray(raw)) return [];
  // In a sealed note a thumbnail is an entry with its key; in the app, and
  // in what is about to be sealed, it is the reference alone.
  const imageOf = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      return isAttachmentRef(value) ? value : undefined;
    }
    const entry = entryRef(value);
    if (!entry) return undefined;
    found?.set(...entry);
    return entry[0];
  };
  const out: LinkPreview[] = [];
  for (const item of raw) {
    if (out.length >= MAX_LINK_PREVIEWS_PER_NOTE) break;
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (!isHttpUrl(p.url)) continue;
    if (
      typeof p.title !== "string" ||
      p.title.length > MAX_LINK_PREVIEW_TITLE_LENGTH
    ) {
      continue;
    }
    const description =
      typeof p.description === "string" &&
      p.description.length <= MAX_LINK_PREVIEW_DESCRIPTION_LENGTH
        ? p.description
        : undefined;
    const image = imageOf(p.image);
    const favicon = imageOf(p.favicon);
    out.push({
      url: p.url,
      title: p.title,
      ...(description !== undefined && { description }),
      ...(image !== undefined && { image }),
      ...(favicon !== undefined && { favicon }),
      domain: new URL(p.url).host,
    });
  }
  return out;
}

/** One image as a sealed note names it: the attachment, and what opens it. */
interface ImageEntry extends ImageKey {
  id: string;
}

/**
 * What opens each image a note holds, by its `attachment:` reference. A note
 * in the app holds references alone; their keys are kept beside it, handed
 * to whatever seals the note and taken from whatever opens it.
 */
export type ImageKeys = ReadonlyMap<string, ImageKey>;

/** The reference an entry names, when the entry is whole; else null. */
function entryRef(item: unknown): [string, ImageKey] | null {
  if (!isImageKey(item)) return null;
  const { id, key, type } = item as ImageEntry;
  const ref = `${ATTACHMENT_REF_PREFIX}${typeof id === "string" ? id : ""}`;
  return isAttachmentRef(ref) ? [ref, { key, type }] : null;
}

/**
 * A note's images as references, from the sealed list's JSON. An entry
 * without a key and a type this app takes is left out, since it could not be
 * opened. Each one's key goes into `found`.
 */
export function checkedImages(
  raw: unknown,
  found: Map<string, ImageKey>,
): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= MAX_IMAGES_PER_NOTE) break;
    const entry = entryRef(item);
    if (!entry) continue;
    out.push(entry[0]);
    found.set(...entry);
  }
  return out;
}

/** Tags as a note may hold them, from anything. */
export function checkedTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const tag of raw) {
    if (out.length >= MAX_TAGS_PER_NOTE) break;
    if (typeof tag !== "string") continue;
    if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) continue;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

async function openText(
  key: CryptoKey,
  sealed: string | undefined,
  data: Uint8Array<ArrayBuffer>,
): Promise<string | null> {
  if (!sealed) return null;
  const bytes = await unseal(key, sealed, data);
  return bytes ? fromUtf8(bytes) : null;
}

function parsed(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Seals the shared fields given, and the excerpt whenever the text is among
 * them. `images` holds what opens each image the fields name. Throws
 * `NoteLimitError` for a value past what a note may hold, or an image whose
 * key is not there.
 */
export async function sealSharedFields(
  key: NoteSealKey,
  noteId: string,
  fields: Partial<SharedPlain>,
  images: ImageKeys = new Map(),
): Promise<Partial<SharedSealed & SealedNoteRefs>> {
  const out: Partial<SharedSealed & SealedNoteRefs> = {};
  const put = (field: keyof SharedSealed, text: string) =>
    seal(key.fields, utf8(text), sharedData(key, noteId, field));
  if (fields.title !== undefined) {
    if (fields.title.length > MAX_NOTE_TITLE_LENGTH) {
      throw new NoteLimitError("title");
    }
    out.title = await put("title", fields.title);
  }
  if (fields.content !== undefined) {
    if (fields.content.length > MAX_NOTE_CONTENT_LENGTH) {
      throw new NoteLimitError("content");
    }
    out.content = await put("content", fields.content);
    out.excerpt = await put("excerpt", excerptOf(fields.content));
  }
  if (fields.font !== undefined) {
    out.font = await put("font", fields.font.padEnd(PADDED_LENGTH, " "));
  }
  if (fields.images !== undefined) {
    // References only: whatever is inline is uploaded before a note is sealed.
    if (
      fields.images.length > MAX_IMAGES_PER_NOTE ||
      !fields.images.every(isAttachmentRef)
    ) {
      throw new NoteLimitError("images");
    }
    const list: ImageEntry[] = [];
    for (const ref of fields.images) {
      const image = images.get(ref);
      // Without its key nobody could open it, this account included.
      if (!image) throw new NoteLimitError("images");
      list.push({ id: attachmentIdOf(ref), ...image });
    }
    out.images = await put("images", JSON.stringify(list));
    out.imageRefs = [...fields.images];
  }
  if (fields.linkPreviews !== undefined) {
    if (fields.linkPreviews.length > MAX_LINK_PREVIEWS_PER_NOTE) {
      throw new NoteLimitError("linkPreviews");
    }
    // A thumbnail whose key is not there is dropped and the card kept: it
    // is a picture of the linked page, not something the user attached.
    const entryOf = (ref: string | undefined): ImageEntry | undefined => {
      const image = ref === undefined ? undefined : images.get(ref);
      return ref !== undefined && image
        ? { id: attachmentIdOf(ref), ...image }
        : undefined;
    };
    const previews = checkedLinkPreviews(fields.linkPreviews).map(
      ({ image, favicon, ...rest }) => {
        const sealedImage = entryOf(image);
        const sealedFavicon = entryOf(favicon);
        return {
          ...rest,
          ...(sealedImage && { image: sealedImage }),
          ...(sealedFavicon && { favicon: sealedFavicon }),
        };
      },
    );
    const json = JSON.stringify(previews);
    if (utf8(json).length > MAX_LINK_PREVIEWS_BYTES) {
      throw new NoteLimitError("linkPreviews");
    }
    out.linkPreviews = await put("linkPreviews", json);
    out.previewRefs = previews.flatMap((p) =>
      [p.image, p.favicon].flatMap((entry) =>
        entry ? [`${ATTACHMENT_REF_PREFIX}${entry.id}`] : [],
      ),
    );
  }
  return out;
}

/** Seals a person's own fields of a note under their personal key. */
export async function sealPersonalFields(
  account: AccountSealKeys,
  noteId: string,
  fields: Partial<PersonalPlain>,
): Promise<Partial<PersonalSealed>> {
  const out: Partial<PersonalSealed> = {};
  if (fields.color !== undefined) {
    out.color = await seal(
      account.personal,
      utf8(fields.color.padEnd(PADDED_LENGTH, " ")),
      personalData(account, noteId, "color"),
    );
  }
  if (fields.tags !== undefined) {
    if (
      fields.tags.length > MAX_TAGS_PER_NOTE ||
      fields.tags.some((t) => t.length === 0 || t.length > MAX_TAG_LENGTH)
    ) {
      throw new NoteLimitError("tags");
    }
    out.tags = await seal(
      account.personal,
      utf8(JSON.stringify(fields.tags)),
      personalData(account, noteId, "tags"),
    );
  }
  return out;
}

/** What `openSharedFields` hands back: the excerpt beside the rest, and
 * what opens each image the fields name. */
export type OpenedSharedFields = SharedPlain & {
  excerpt: string;
  imageKeys: Map<string, ImageKey>;
};

/** Opens and checks a note's shared fields; one that fails is its default. */
export async function openSharedFields(
  key: NoteSealKey,
  noteId: string,
  sealed: Partial<SharedSealed>,
): Promise<OpenedSharedFields> {
  return checkedShared(await openSharedTexts(key, noteId, sealed));
}

/**
 * `openSharedFields` when `opensSharedFields` would say the key is the
 * note's, else null: the same answer as asking both, each field opened once.
 */
export async function openSharedFieldsUnder(
  key: NoteSealKey,
  noteId: string,
  sealed: Partial<SharedSealed>,
): Promise<OpenedSharedFields | null> {
  const texts = await openSharedTexts(key, noteId, sealed);
  return provingFields(sealed).every((field) => texts[field] !== null)
    ? checkedShared(texts)
    : null;
}

type SharedTexts = Record<keyof SharedSealed, string | null>;

async function openSharedTexts(
  key: NoteSealKey,
  noteId: string,
  sealed: Partial<SharedSealed>,
): Promise<SharedTexts> {
  const open = (field: keyof SharedSealed) =>
    openText(key.fields, sealed[field], sharedData(key, noteId, field));
  return {
    title: await open("title"),
    content: await open("content"),
    excerpt: await open("excerpt"),
    font: await open("font"),
    images: await open("images"),
    linkPreviews: await open("linkPreviews"),
  };
}

function checkedShared(texts: SharedTexts): OpenedSharedFields {
  const { title, content, excerpt } = texts;
  const font = texts.font?.trimEnd() ?? "";
  const imageKeys = new Map<string, ImageKey>();
  return {
    imageKeys,
    title: title !== null && title.length <= MAX_NOTE_TITLE_LENGTH ? title : "",
    content:
      content !== null && content.length <= MAX_NOTE_CONTENT_LENGTH
        ? content
        : "",
    excerpt:
      excerpt !== null && excerpt.length <= NOTE_EXCERPT_LENGTH * 2
        ? excerpt
        : "",
    font: fonts.has(font) ? (font as NoteFont) : NoteFont.Default,
    images: checkedImages(parsed(texts.images), imageKeys),
    linkPreviews: checkedLinkPreviews(parsed(texts.linkPreviews), imageKeys),
  };
}

/** The fields `opensSharedFields` holds a key to; see there. */
function provingFields(sealed: Partial<SharedSealed>): (keyof SharedSealed)[] {
  const words = (["title", "content", "excerpt"] as const).filter(
    (field) => sealed[field],
  );
  return words.length > 0
    ? words
    : (["font", "images", "linkPreviews"] as const).filter(
        (field) => sealed[field],
      );
}

/**
 * Whether `key` is the key the note's words are under: it opens every one of
 * its title, content and excerpt that `sealed` carries, or, where it carries
 * none of them, every field it does carry. `openSharedFields` reads a field
 * that does not open as empty, so a wrong key would show an empty note, and
 * the next edit would seal over everyone's words with it. One field opening
 * is not enough: anyone who may edit the note can write a field under a key
 * of their own making, and then offer that key. Asked of a key that came from
 * someone else before it is kept. True where `sealed` carries no field at
 * all, which leaves nothing to tell by.
 */
export async function opensSharedFields(
  key: NoteSealKey,
  noteId: string,
  sealed: Partial<SharedSealed>,
): Promise<boolean> {
  for (const field of provingFields(sealed)) {
    const opened = await openText(
      key.fields,
      sealed[field],
      sharedData(key, noteId, field),
    );
    if (opened === null) return false;
  }
  return true;
}

/** Opens and checks a person's own fields; an empty one was never set. */
export async function openPersonalFields(
  account: AccountSealKeys,
  noteId: string,
  sealed: Partial<PersonalSealed>,
): Promise<PersonalPlain> {
  const color =
    (
      await openText(
        account.personal,
        sealed.color,
        personalData(account, noteId, "color"),
      )
    )?.trimEnd() ?? "";
  const tags = parsed(
    await openText(
      account.personal,
      sealed.tags,
      personalData(account, noteId, "tags"),
    ),
  );
  return {
    color: colors.has(color) ? (color as NoteColor) : NoteColor.Default,
    tags: checkedTags(tags),
  };
}

/** A new note, sealed under a key made for it. */
export async function sealNewNote(
  account: AccountSealKeys,
  id: string,
  note: NoteCreate,
  imageKeys: ImageKeys = new Map(),
): Promise<{ sealed: SealedNoteCreate; key: NoteSealKey }> {
  const { title, content, font, images, linkPreviews, color, tags, ...rest } =
    note;
  const raw = newNoteKey();
  try {
    const key = await noteSealKey(raw, 1);
    const shared = await sealSharedFields(
      key,
      id,
      { title, content, font, images, linkPreviews },
      imageKeys,
    );
    const personal = await sealPersonalFields(account, id, { color, tags });
    return {
      key,
      sealed: {
        ...rest,
        id,
        key: await wrapNoteKey(account, id, key.version, raw),
        keyVersion: key.version,
        ...(shared as SharedSealed & SealedNoteRefs),
        ...(personal as PersonalSealed),
      },
    };
  } finally {
    wipe(raw);
  }
}

/** The changes of an update, with the words among them sealed. */
export async function sealNoteUpdate(
  account: AccountSealKeys,
  key: NoteSealKey,
  id: string,
  changes: NoteUpdate,
  imageKeys: ImageKeys = new Map(),
): Promise<SealedNoteUpdate> {
  const { title, content, font, images, linkPreviews, color, tags, ...rest } =
    changes;
  return {
    ...rest,
    ...(await sealSharedFields(
      key,
      id,
      {
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(font !== undefined && { font }),
        ...(images !== undefined && { images }),
        ...(linkPreviews !== undefined && { linkPreviews }),
      },
      imageKeys,
    )),
    ...(await sealPersonalFields(account, id, {
      ...(color !== undefined && { color }),
      ...(tags !== undefined && { tags }),
    })),
  };
}

/**
 * A sealed note as its reader sees it. `known` saves unwrapping the key again
 * when it is still the one the note is under. Null when the reader's key for
 * the note does not open, which leaves nothing of it to show.
 */
export async function openSealedNote(
  account: AccountSealKeys,
  sealed: SealedNote,
  known?: NoteSealKey,
): Promise<{
  note: Note;
  key: NoteSealKey;
  excerpt: string;
  imageKeys: Map<string, ImageKey>;
} | null> {
  const key =
    known?.version === sealed.keyVersion
      ? known
      : await openNoteKey(account, sealed.id, sealed.keyVersion, sealed.key);
  if (!key) return null;
  const {
    key: _key,
    keyVersion: _keyVersion,
    previousKeys: _previousKeys,
    rekeyDue: _rekeyDue,
    reminderKey: _reminderKey,
    excerpt: _excerpt,
    title: _title,
    content: _content,
    font: _font,
    images: _images,
    linkPreviews: _linkPreviews,
    color: _color,
    tags: _tags,
    ...rest
  } = sealed;
  const { excerpt, imageKeys, ...shared } = await openSharedFields(
    key,
    sealed.id,
    sealed,
  );
  const personal = await openPersonalFields(account, sealed.id, sealed);
  return { key, excerpt, imageKeys, note: { ...rest, ...shared, ...personal } };
}

/** A version's title and text, sealed under the note key and bound to the
 * version's own id. */
export async function sealVersion(
  key: NoteSealKey,
  versionId: string,
  version: Pick<NoteVersion, "title" | "content">,
): Promise<Pick<SealedNoteVersion, "title" | "content" | "keyVersion">> {
  if (version.title.length > MAX_NOTE_TITLE_LENGTH) {
    throw new NoteLimitError("title");
  }
  if (version.content.length > MAX_NOTE_CONTENT_LENGTH) {
    throw new NoteLimitError("content");
  }
  return {
    keyVersion: key.version,
    title: await seal(
      key.fields,
      utf8(version.title),
      sharedData(key, versionId, "version/title"),
    ),
    content: await seal(
      key.fields,
      utf8(version.content),
      sharedData(key, versionId, "version/content"),
    ),
  };
}

/** Null when the version is under another key, or does not open. */
export async function openVersion(
  key: NoteSealKey,
  sealed: SealedNoteVersion,
): Promise<NoteVersion | null> {
  if (sealed.keyVersion !== key.version) return null;
  const title = await openText(
    key.fields,
    sealed.title,
    sharedData(key, sealed.id, "version/title"),
  );
  const content = await openText(
    key.fields,
    sealed.content,
    sharedData(key, sealed.id, "version/content"),
  );
  if (title === null || content === null) return null;
  if (
    title.length > MAX_NOTE_TITLE_LENGTH ||
    content.length > MAX_NOTE_CONTENT_LENGTH
  ) {
    return null;
  }
  return {
    noteId: sealed.noteId,
    timestamp: sealed.timestamp,
    title,
    content,
  };
}

/**
 * A comment's text, sealed under the note key and bound to the comment's own
 * id. Throws `NoteLimitError` for one that is empty or too long, which the
 * server can no longer tell.
 */
export async function sealComment(
  key: NoteSealKey,
  commentId: string,
  body: string,
): Promise<{ body: string; keyVersion: number }> {
  const text = body.trim();
  if (text.length === 0 || text.length > MAX_COMMENT_LENGTH) {
    throw new NoteLimitError("comment");
  }
  return {
    keyVersion: key.version,
    body: await seal(
      key.fields,
      utf8(text),
      sharedData(key, commentId, "comment"),
    ),
  };
}

/** A comment's text; null when it is under another key, or does not open. */
export async function openComment(
  key: NoteSealKey,
  comment: { id: string; keyVersion: number; body: string },
): Promise<string | null> {
  if (comment.keyVersion !== key.version) return null;
  const text = await openText(
    key.fields,
    comment.body,
    sharedData(key, comment.id, "comment"),
  );
  return text !== null && text.length <= MAX_COMMENT_LENGTH ? text : null;
}

/** One preference, sealed under the account's personal key and bound to its
 * name. */
export function sealPref(
  account: AccountSealKeys,
  name: string,
  value: unknown,
): Promise<string> {
  return seal(
    account.personal,
    utf8(JSON.stringify(value)),
    personalData(account, name, "pref"),
  );
}

/** The preference's value; undefined when it does not open. */
export async function openPref(
  account: AccountSealKeys,
  name: string,
  sealed: unknown,
): Promise<unknown> {
  if (typeof sealed !== "string") return undefined;
  const text = await openText(
    account.personal,
    sealed,
    personalData(account, name, "pref"),
  );
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
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
  if (!sealed) return out;
  const text = await openText(
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
      if (raw.length === 32) out.set(version, raw);
    }
  } catch {
    out.clear();
  }
  return out;
}

/**
 * A note's shared fields, moved from one key to another without being read:
 * each is opened and sealed again as it is. Null when any of them does not
 * open, so that replacing a key never writes an empty note over one this
 * device could not read.
 */
export async function resealSharedFields(
  from: NoteSealKey,
  to: NoteSealKey,
  noteId: string,
  sealed: SharedSealed,
): Promise<SharedSealed | null> {
  const out = {} as SharedSealed;
  const fields = [
    "title",
    "content",
    "excerpt",
    "font",
    "images",
    "linkPreviews",
  ] as const;
  for (const field of fields) {
    // Never set: sealed as nothing, which opens as nothing.
    const text =
      sealed[field] === ""
        ? ""
        : await openText(
            from.fields,
            sealed[field],
            sharedData(from, noteId, field),
          );
    if (text === null) return null;
    out[field] = await seal(
      to.fields,
      utf8(text),
      sharedData(to, noteId, field),
    );
  }
  return out;
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

function imageKeyData(account: AccountSealKeys, attachmentId: string) {
  return associatedData({
    id: attachmentId,
    field: "attachment-key",
    version: account.version,
    account: account.userId,
  });
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
  if (!wrapped) return null;
  const text = await openText(
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
