import { MAX_COMMENT_LENGTH } from "#/api/comments.ts";
import { MAX_ACCOUNT_PREFS_BYTES } from "#/api/prefs.ts";
import type {
  SealedNote,
  SealedNoteCreate,
  SealedNoteRefs,
  SealedNoteUpdate,
  SealedNoteVersion,
} from "#/api/sealed.ts";
import {
  ATTACHMENT_REF_PREFIX,
  attachmentIdOf,
  isAttachmentRef,
  MAX_IMAGE_ALT_LENGTH,
  MAX_IMAGES_PER_NOTE,
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
} from "#/note.ts";
import {
  currentNoteFormat,
  isNewerNoteFormat,
  upgradeNoteWords,
} from "#/noteFormat.ts";
import { utf8, wipe } from "./bytes.ts";
import type { ImageKey } from "./imageSeal.ts";
import {
  checkedImages,
  checkedLinkPreviews,
  checkedTags,
  type ImageEntry,
  type ImageKeys,
} from "./noteChecks.ts";
import {
  type AccountSealKeys,
  type NoteSealKey,
  newNoteKey,
  noteSealKey,
  openNoteKey,
  personalData,
  sharedData,
  wrapNoteKey,
} from "./noteKey.ts";
import { seal, sealedLength, unsealText } from "./seal.ts";

/**
 * A note's words, sealed and opened
 * (`docs/specification/features/encryption.md`, "Keys").
 *
 * What everyone on a note sees (title, text, excerpt, font, link previews)
 * is under the note key (`noteKey.ts`). What is one person's own (colour,
 * tags) is under their personal key. Both sides of a readable request use
 * this: the browser always, and the server for a token that carries a key.
 *
 * What is opened was written by some client and checked by no server, so
 * every value is checked before it is handed on (`noteChecks.ts`), and one
 * that fails is left out.
 */

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
  images: sealedLength(MAX_IMAGES_PER_NOTE * (256 + MAX_IMAGE_ALT_LENGTH * 6)),
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

/** The first characters of a note's text, whole ones. */
export function excerptOf(content: string): string {
  return Array.from(content.slice(0, NOTE_EXCERPT_LENGTH * 2))
    .slice(0, NOTE_EXCERPT_LENGTH)
    .join("");
}

type SharedPlain = Pick<
  Note,
  "title" | "content" | "font" | "images" | "imageAlts" | "linkPreviews"
>;
type PersonalPlain = Pick<Note, "color" | "tags">;
export type SharedSealed = Pick<
  SealedNote,
  "title" | "content" | "excerpt" | "font" | "images" | "linkPreviews"
>;
type PersonalSealed = Pick<SealedNote, "color" | "tags">;

const colors = new Set<string>(Object.values(NoteColor));
const fonts = new Set<string>(Object.values(NoteFont));

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
    for (const [i, ref] of fields.images.entries()) {
      const image = images.get(ref);
      // Without its key nobody could open it, this account included.
      if (!image) throw new NoteLimitError("images");
      const alt = fields.imageAlts?.[i] ?? "";
      if (alt.length > MAX_IMAGE_ALT_LENGTH) throw new NoteLimitError("images");
      list.push({ id: attachmentIdOf(ref), ...image, ...(alt && { alt }) });
    }
    out.images = await put("images", JSON.stringify(list));
    out.imageRefs = [...fields.images];
  } else if (fields.imageAlts !== undefined) {
    // The descriptions live in the image list's entries, so they are sealed
    // only with the list: a writer that changes them sends both.
    throw new NoteLimitError("images");
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
    unsealText(key.fields, sealed[field], sharedData(key, noteId, field));
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
  const imageAlts: string[] = [];
  const images = checkedImages(parsed(texts.images), imageKeys, imageAlts);
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
    images,
    ...(imageAlts.some((alt) => alt !== "") && { imageAlts }),
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
    const opened = await unsealText(
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
      await unsealText(
        account.personal,
        sealed.color,
        personalData(account, noteId, "color"),
      )
    )?.trimEnd() ?? "";
  const tags = parsed(
    await unsealText(
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
  const {
    title,
    content,
    font,
    images,
    imageAlts,
    linkPreviews,
    color,
    tags,
    ...rest
  } = note;
  const raw = newNoteKey();
  try {
    const key = await noteSealKey(raw, 1);
    const shared = await sealSharedFields(
      key,
      id,
      {
        title,
        content,
        font,
        images,
        ...(imageAlts !== undefined && { imageAlts }),
        linkPreviews,
      },
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
        format: currentNoteFormat(),
        ...(shared as SharedSealed & SealedNoteRefs),
        ...(personal as PersonalSealed),
      },
    };
  } finally {
    wipe(raw);
  }
}

/**
 * The changes of an update, with the words among them sealed, and the format
 * they are in whenever there are any. A note stored in an older format takes
 * every word at once (`withEveryWord`): the server keeps one format for all
 * of them, and refuses a part of them in a newer one.
 */
export async function sealNoteUpdate(
  account: AccountSealKeys,
  key: NoteSealKey,
  id: string,
  changes: NoteUpdate,
  imageKeys: ImageKeys = new Map(),
): Promise<SealedNoteUpdate> {
  const {
    title,
    content,
    font,
    images,
    imageAlts,
    linkPreviews,
    color,
    tags,
    ...rest
  } = changes;
  const shared = await sealSharedFields(
    key,
    id,
    {
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(font !== undefined && { font }),
      ...(images !== undefined && { images }),
      ...(imageAlts !== undefined && { imageAlts }),
      ...(linkPreviews !== undefined && { linkPreviews }),
    },
    imageKeys,
  );
  return {
    ...rest,
    ...shared,
    ...(Object.keys(shared).length > 0 && { format: currentNoteFormat() }),
    ...(await sealPersonalFields(account, id, {
      ...(color !== undefined && { color }),
      ...(tags !== undefined && { tags }),
    })),
  };
}

/**
 * A sealed note as its reader sees it, in the current format. `known` saves
 * unwrapping the key again when it is still the one the note is under. Null
 * when the reader's key for the note does not open, which leaves nothing of
 * it to show, and for a note in a format newer than this build reads.
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
  if (!key || isNewerNoteFormat(sealed.format)) return null;
  const {
    key: _key,
    keyVersion: _keyVersion,
    format: _format,
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
  const words = upgradeNoteWords(shared, sealed.format);
  return { key, excerpt, imageKeys, note: { ...rest, ...words, ...personal } };
}

/** A version's title and text, sealed under the note key and bound to the
 * version's own id. */
export async function sealVersion(
  key: NoteSealKey,
  versionId: string,
  version: Pick<NoteVersion, "title" | "content">,
): Promise<
  Pick<SealedNoteVersion, "title" | "content" | "keyVersion" | "format">
> {
  if (version.title.length > MAX_NOTE_TITLE_LENGTH) {
    throw new NoteLimitError("title");
  }
  if (version.content.length > MAX_NOTE_CONTENT_LENGTH) {
    throw new NoteLimitError("content");
  }
  return {
    keyVersion: key.version,
    format: currentNoteFormat(),
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

/** The version in the current format. Null when it is under another key,
 * does not open, or is in a format newer than this build reads. */
export async function openVersion(
  key: NoteSealKey,
  sealed: SealedNoteVersion,
): Promise<NoteVersion | null> {
  if (sealed.keyVersion !== key.version) return null;
  if (isNewerNoteFormat(sealed.format)) return null;
  const title = await unsealText(
    key.fields,
    sealed.title,
    sharedData(key, sealed.id, "version/title"),
  );
  const content = await unsealText(
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
    ...upgradeNoteWords({ title, content }, sealed.format),
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
  const text = await unsealText(
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
  const text = await unsealText(
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
        : await unsealText(
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
