import type {
  SealedNote,
  SealedNoteCreate,
  SealedNoteRefs,
  SealedNoteUpdate,
  SealedNoteVersion,
  SealedNoteVersionCreateRequest,
} from "#/api/sealed.ts";
import {
  MAX_NOTE_CONTENT_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  type Note,
  type NoteCreate,
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
import { checkedImages, type ImageKeys } from "./noteChecks.ts";
import {
  type AccountSealKeys,
  type NoteSealKey,
  newNoteKey,
  noteSealKey,
  openNoteKey,
  sharedData,
  wrapNoteKey,
} from "./noteKey.ts";
import {
  imageList,
  NoteLimitError,
  openPersonalFields,
  openSharedFields,
  type PersonalSealed,
  parsed,
  type SharedSealed,
  sealPersonalFields,
  sealSharedFields,
} from "./noteSeal.ts";
import { seal, unsealText } from "./seal.ts";

/**
 * A whole note and its versions, sealed and opened, from the fields that
 * `noteSeal.ts` seals.
 */

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
