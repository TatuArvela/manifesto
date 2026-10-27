import { MAX_COMMENT_LENGTH } from "#/api/comments.ts";
import { MAX_ACCOUNT_PREFS_BYTES } from "#/api/prefs.ts";
import type {
  SealedNote,
  SealedNoteCreate,
  SealedNoteRefs,
  SealedNoteUpdate,
  SealedNoteVersion,
  SealedNoteVersionCreateRequest,
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
 * The words of a note, sealed and opened
 * (`docs/specification/features/encryption.md`, "Keys").
 *
 * What all persons on a note see (title, text, excerpt, font, link previews) is
 * under the note key (`noteKey.ts`). What belongs to one person (color, tags)
 * is under their personal key. Both sides of a readable request use this:
 * always the browser, and the server for a token that carries a key.
 *
 * A client wrote the opened data, and no server checked it. Thus, the code
 * checks each value before it gives it on (`noteChecks.ts`), and removes a
 * value that fails.
 */

/**
 * There are few colors and fonts, and the length of a ciphertext would tell the
 * value inside. Thus, each value has padding to this number of characters.
 */
const PADDED_LENGTH = 24;

/** The maximum size of the link previews of a note, as JSON. */
const MAX_LINK_PREVIEWS_BYTES = 300_000;

/**
 * The maximum length of the ciphertext of each sealed field. The server checks
 * a field against this and against the shape of a ciphertext, which is all that
 * it can check. A UTF-16 unit is a maximum of three bytes of UTF-8, and six
 * after JSON escapes it.
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

/**
 * A value that the client refuses to seal, as the server refused to store it
 * before.
 */
export class NoteLimitError extends Error {
  constructor(public readonly field: string) {
    super(`The note's ${field} is past what a note may hold`);
    this.name = "NoteLimitError";
  }
}

/** The first characters of the text of a note, full characters only. */
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
 * The image list of a note or a version, as the JSON to seal: each reference
 * with its key and its description. Throws `NoteLimitError` for a list that is
 * too long, a value that is not a reference, a description that is too long,
 * or an image whose key is not in `images`.
 */
function imageList(
  refs: readonly string[],
  alts: readonly string[] | undefined,
  images: ImageKeys,
): string {
  // Only references. The app uploads all inline data before it seals a note.
  if (refs.length > MAX_IMAGES_PER_NOTE || !refs.every(isAttachmentRef)) {
    throw new NoteLimitError("images");
  }
  const list: ImageEntry[] = [];
  for (const [i, ref] of refs.entries()) {
    const image = images.get(ref);
    // Without its key, nobody could open it, also not this account.
    if (!image) throw new NoteLimitError("images");
    const alt = alts?.[i] ?? "";
    if (alt.length > MAX_IMAGE_ALT_LENGTH) throw new NoteLimitError("images");
    list.push({ id: attachmentIdOf(ref), ...image, ...(alt && { alt }) });
  }
  return JSON.stringify(list);
}

/**
 * Seals the given shared fields, and the excerpt when the text is among them.
 * `images` contains what opens each image that the fields name. Throws
 * `NoteLimitError` for a value that is larger than a note can contain, or for
 * an image whose key is not there.
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
    const list = imageList(fields.images, fields.imageAlts, images);
    out.images = await put("images", list);
    out.imageRefs = [...fields.images];
  } else if (fields.imageAlts !== undefined) {
    // The descriptions are in the entries of the image list. Thus, they are
    // sealed only with the list. A writer that changes them sends both.
    throw new NoteLimitError("images");
  }
  if (fields.linkPreviews !== undefined) {
    if (fields.linkPreviews.length > MAX_LINK_PREVIEWS_PER_NOTE) {
      throw new NoteLimitError("linkPreviews");
    }
    // The code removes a thumbnail whose key is not there, and keeps the card.
    // It is a picture of the linked page, not a file that the user attached.
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

/** Seals the own fields of a note of a person under their personal key. */
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

/**
 * What `openSharedFields` gives back: the excerpt with the other fields, and
 * what opens each image that the fields name.
 */
export type OpenedSharedFields = SharedPlain & {
  excerpt: string;
  imageKeys: Map<string, ImageKey>;
};

/**
 * Opens and checks the shared fields of a note. A field that fails gets its
 * default.
 */
export async function openSharedFields(
  key: NoteSealKey,
  noteId: string,
  sealed: Partial<SharedSealed>,
): Promise<OpenedSharedFields> {
  return checkedShared(await openSharedTexts(key, noteId, sealed));
}

/**
 * `openSharedFields` when `opensSharedFields` would say that the key belongs to
 * the note. Otherwise null. This is the same answer as a call to both, with
 * each field opened one time.
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

/** The fields that `opensSharedFields` checks against a key. See there. */
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
 * If `key` is the key of the words of the note: it opens each title, content
 * and excerpt that `sealed` contains. If it contains none of them, the key must
 * open each field that it contains.
 *
 * `openSharedFields` reads a field that does not open as empty. Thus, a wrong
 * key would show an empty note, and the next edit would seal over the words of
 * all persons with it. It is not sufficient that one field opens. Each person
 * who can edit the note can write a field under their own key, and then offer
 * that key. The code asks this about a key from a different person before it
 * keeps the key. True where `sealed` contains no field, because then there is
 * nothing to check.
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

/**
 * Opens and checks the own fields of a person. An empty field was never set.
 */
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
 * The changes of an update, with their words sealed, and with their format when
 * there are words. A note stored in an older format gets all words at the same
 * time (`withEveryWord`). The server keeps one format for all of them, and
 * refuses a part of them in a newer format.
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
 * A sealed note as its reader sees it, in the current format. `known` prevents
 * a second unwrap of the key when it is still the current key of the note. Null
 * when the key of the reader for the note does not open, because then there is
 * nothing to show. Also null for a note in a format that is newer than this
 * build can read.
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

/**
 * The title, text and images of a version, sealed under the note key and bound
 * to the own id of the version. `images` contains what opens each image that
 * the version names, as for a note.
 */
export async function sealVersion(
  key: NoteSealKey,
  versionId: string,
  version: Pick<NoteVersion, "title" | "content" | "images" | "imageAlts">,
  images: ImageKeys = new Map(),
): Promise<
  Pick<
    SealedNoteVersionCreateRequest,
    "title" | "content" | "images" | "imageRefs" | "keyVersion" | "format"
  >
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
    ...(version.images !== undefined && {
      images: await seal(
        key.fields,
        utf8(imageList(version.images, version.imageAlts, images)),
        sharedData(key, versionId, "version/images"),
      ),
      imageRefs: [...version.images],
    }),
  };
}

/**
 * The version in the current format, with what opens each of its images. Null
 * when it is under a different key, does not open, or is in a format that is
 * newer than this build can read. A version whose images do not open has no
 * `images`, as a version from before they were kept.
 */
export async function openVersion(
  key: NoteSealKey,
  sealed: SealedNoteVersion,
): Promise<(NoteVersion & { imageKeys: Map<string, ImageKey> }) | null> {
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
  const imageKeys = new Map<string, ImageKey>();
  const list =
    sealed.images === undefined
      ? null
      : await unsealText(
          key.fields,
          sealed.images,
          sharedData(key, sealed.id, "version/images"),
        );
  const imageAlts: string[] = [];
  const images =
    list === null ? null : checkedImages(parsed(list), imageKeys, imageAlts);
  return {
    noteId: sealed.noteId,
    timestamp: sealed.timestamp,
    ...upgradeNoteWords({ title, content }, sealed.format),
    ...(images && { images }),
    ...(images && imageAlts.some((alt) => alt !== "") && { imageAlts }),
    imageKeys,
  };
}

/**
 * The text of a comment, sealed under the note key and bound to the own id of
 * the comment. Throws `NoteLimitError` for a comment that is empty or too long,
 * because the server cannot check this now.
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

/**
 * The text of a comment. Null when it is under a different key, or does not
 * open.
 */
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

/**
 * One preference, sealed under the personal key of the account and bound to its
 * name.
 */
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

/** The value of the preference. Undefined when it does not open. */
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
 * The shared fields of a note, moved from one key to a different key without a
 * read: the code opens each one, and seals it again as it is. Null when one of
 * them does not open. Thus, a key replacement never writes an empty note over a
 * note that this device could not read.
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
