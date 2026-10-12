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
  previewImages,
} from "../note.js";
import { fromUtf8, utf8, wipe } from "./bytes.js";
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

/** A note's key, ready to use and not readable. */
export interface NoteSealKey {
  version: number;
  fields: CryptoKey;
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
  return {
    version,
    fields: await deriveKey(await derivable(raw), "note/fields"),
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
type SharedSealed = Pick<
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
 */
export function checkedLinkPreviews(raw: unknown): LinkPreview[] {
  if (!Array.isArray(raw)) return [];
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
    if (typeof p.domain !== "string" || p.domain.length > 255) continue;
    const description =
      typeof p.description === "string" &&
      p.description.length <= MAX_LINK_PREVIEW_DESCRIPTION_LENGTH
        ? p.description
        : undefined;
    const image =
      typeof p.image === "string" && isAttachmentRef(p.image)
        ? p.image
        : undefined;
    const favicon =
      typeof p.favicon === "string" && isAttachmentRef(p.favicon)
        ? p.favicon
        : undefined;
    out.push({
      url: p.url,
      title: p.title,
      ...(description !== undefined && { description }),
      ...(image !== undefined && { image }),
      ...(favicon !== undefined && { favicon }),
      domain: p.domain,
    });
  }
  return out;
}

/** One image of a note, as the sealed list holds it. */
interface SealedImage {
  id: string;
}

/** A note's images as references, from the sealed list's JSON. */
export function checkedImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= MAX_IMAGES_PER_NOTE) break;
    if (typeof item !== "object" || item === null) continue;
    const { id } = item as Partial<SealedImage>;
    const ref = `${ATTACHMENT_REF_PREFIX}${typeof id === "string" ? id : ""}`;
    if (isAttachmentRef(ref)) out.push(ref);
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
 * them. Throws `NoteLimitError` for a value past what a note may hold.
 */
export async function sealSharedFields(
  key: NoteSealKey,
  noteId: string,
  fields: Partial<SharedPlain>,
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
    const list: SealedImage[] = fields.images.map((ref) => ({
      id: attachmentIdOf(ref),
    }));
    out.images = await put("images", JSON.stringify(list));
    out.imageRefs = [...fields.images];
  }
  if (fields.linkPreviews !== undefined) {
    if (fields.linkPreviews.length > MAX_LINK_PREVIEWS_PER_NOTE) {
      throw new NoteLimitError("linkPreviews");
    }
    const previews = checkedLinkPreviews(fields.linkPreviews);
    const json = JSON.stringify(previews);
    if (utf8(json).length > MAX_LINK_PREVIEWS_BYTES) {
      throw new NoteLimitError("linkPreviews");
    }
    out.linkPreviews = await put("linkPreviews", json);
    out.previewRefs = previewImages(previews);
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

/** What `openSharedFields` hands back: the excerpt beside the rest. */
export type OpenedSharedFields = SharedPlain & { excerpt: string };

/** Opens and checks a note's shared fields; one that fails is its default. */
export async function openSharedFields(
  key: NoteSealKey,
  noteId: string,
  sealed: Partial<SharedSealed>,
): Promise<OpenedSharedFields> {
  const open = (field: keyof SharedSealed) =>
    openText(key.fields, sealed[field], sharedData(key, noteId, field));
  const title = await open("title");
  const content = await open("content");
  const excerpt = await open("excerpt");
  const font = (await open("font"))?.trimEnd() ?? "";
  return {
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
    images: checkedImages(parsed(await open("images"))),
    linkPreviews: checkedLinkPreviews(parsed(await open("linkPreviews"))),
  };
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
): Promise<{ sealed: SealedNoteCreate; key: NoteSealKey }> {
  const { title, content, font, images, linkPreviews, color, tags, ...rest } =
    note;
  const raw = newNoteKey();
  try {
    const key = await noteSealKey(raw, 1);
    const shared = await sealSharedFields(key, id, {
      title,
      content,
      font,
      images,
      linkPreviews,
    });
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
): Promise<SealedNoteUpdate> {
  const { title, content, font, images, linkPreviews, color, tags, ...rest } =
    changes;
  return {
    ...rest,
    ...(await sealSharedFields(key, id, {
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(font !== undefined && { font }),
      ...(images !== undefined && { images }),
      ...(linkPreviews !== undefined && { linkPreviews }),
    })),
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
): Promise<{ note: Note; key: NoteSealKey; excerpt: string } | null> {
  const key =
    known?.version === sealed.keyVersion
      ? known
      : await openNoteKey(account, sealed.id, sealed.keyVersion, sealed.key);
  if (!key) return null;
  const {
    key: _key,
    keyVersion: _keyVersion,
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
  const { excerpt, ...shared } = await openSharedFields(key, sealed.id, sealed);
  const personal = await openPersonalFields(account, sealed.id, sealed);
  return { key, excerpt, note: { ...rest, ...shared, ...personal } };
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
