export enum NoteColor {
  Default = "default",
  Red = "red",
  Orange = "orange",
  Yellow = "yellow",
  Green = "green",
  Teal = "teal",
  Blue = "blue",
  Purple = "purple",
  Pink = "pink",
  Brown = "brown",
  Gray = "gray",
}

export enum NoteFont {
  Default = "default",
  Serif = "serif",
  Monospace = "monospace",
  PermanentMarker = "permanent-marker",
  ComicRelief = "comic-relief",
  RougeScript = "rouge-script",
}

export interface LinkPreview {
  url: string;
  title: string;
  description?: string;
  /**
   * A small thumbnail, kept as the `images` of a note: an `attachment:`
   * reference in connected mode, `local:` in open mode, and a `data:` URL only
   * in an export or in an import that comes in. Never the own URL of the linked
   * site.
   */
  image?: string;
  /** The icon of the site, kept in the same way. */
  favicon?: string;
  domain: string;
}

/** All images of the previews: each thumbnail and favicon. */
export function previewImages(previews: readonly LinkPreview[]): string[] {
  const out: string[] = [];
  for (const preview of previews) {
    if (preview.image) out.push(preview.image);
    if (preview.favicon) out.push(preview.favicon);
  }
  return out;
}

/**
 * The previews, with each thumbnail and favicon sent through `map`, in order.
 * If `map` returns `undefined`, the code removes that image and keeps the card.
 */
export async function mapPreviewImages(
  previews: readonly LinkPreview[],
  map: (image: string) => Promise<string | undefined>,
): Promise<LinkPreview[]> {
  const out: LinkPreview[] = [];
  for (const { image, favicon, ...rest } of previews) {
    const nextImage = image ? await map(image) : undefined;
    const nextFavicon = favicon ? await map(favicon) : undefined;
    out.push({
      ...rest,
      ...(nextImage && { image: nextImage }),
      ...(nextFavicon && { favicon: nextFavicon }),
    });
  }
  return out;
}

/** The maximum number of link previews on one note. */
export const MAX_LINK_PREVIEWS_PER_NOTE = 20;

export const MAX_LINK_PREVIEW_TITLE_LENGTH = 500;
export const MAX_LINK_PREVIEW_DESCRIPTION_LENGTH = 2000;

// The maximum size of the own words of a note. The server cannot count inside a
// ciphertext. Thus, the client that seals a note applies these limits, and a
// client that opens a note removes a value that is larger.
export const MAX_NOTE_TITLE_LENGTH = 500;
export const MAX_NOTE_CONTENT_LENGTH = 100_000;
export const MAX_TAGS_PER_NOTE = 50;
export const MAX_TAG_LENGTH = 64;

/** How much of the text of a note is kept next to it, for a notification. */
export const NOTE_EXCERPT_LENGTH = 140;

/** The maximum length of the URL of a link preview. */
export const MAX_LINK_PREVIEW_URL_LENGTH = 2048;

/**
 * The limit for a preview thumbnail or favicon, measured on the encoded `data:`
 * URL to which the client draws it before it stores it. A card shows either one
 * at a few dozen pixels. Thus, the client makes the image from the server fit
 * this limit, and does not store the full-size image of the page.
 */
export const MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES = 64 * 1024;

/**
 * The image subtypes that `Note.images` accepts.
 *
 * Attached images are inlined as `data:` URLs, not uploaded. Thus, this list is
 * a security boundary, not a convenience. `data:` is a same-origin scheme. If
 * the app accepted `data:text/html` or `data:image/svg+xml`, a note could carry
 * executable markup into each surface that renders an attachment by URL. For
 * exactly that reason, SVG is excluded: it is a document format that is also an
 * image.
 */
export const IMAGE_DATA_URL_SUBTYPES = [
  "png",
  "jpeg",
  "jpg",
  "gif",
  "webp",
  "avif",
] as const;

/**
 * The largest stored image, after the client makes it smaller (`shrinkImage`
 * keeps a photo at 2560 pixels on its long edge, which is much less than this).
 * It is the maximum for images that the client does not make smaller: a large
 * screenshot, an animated GIF, an API client that uploads as it wants. The
 * error messages show it through `formatFileSize` ("5 MB", "5 Mt").
 *
 * It is 5 MiB, not a round 5,000,000, because the platforms do not agree about
 * the meaning of "MB". This value never refuses a file that the user was told
 * would fit. Windows labels MiB as MB. Thus, a file that it shows as "5.00 MB"
 * is exactly this, and the app accepts it. macOS shows the same file as 5.24
 * MB, which only accepts a little more than it says.
 */
export const MAX_IMAGE_SOURCE_BYTES = 5 * 1024 * 1024;

/**
 * The same limit on the encoded `data:` URL. That is the form that goes over
 * the wire and that the note row contains. Thus, it is the form to limit. The
 * code derives it, and does not write it as a number. base64 makes 4 characters
 * for each 3 bytes. The `data:image/…;base64,` prefix also counts, at 23
 * characters for the longest accepted media type. With a manually rounded
 * limit, a file of exactly MAX_IMAGE_SOURCE_BYTES would be larger than the
 * limit, and the app would refuse it 18 bytes before the advertised number.
 *
 * The request body limit in `app.ts` of the server also limits the full note.
 * That limit prevents twenty images, each under this limit, from making a 40 MB
 * write together.
 */
export const MAX_IMAGE_DATA_URL_BYTES =
  Math.ceil(MAX_IMAGE_SOURCE_BYTES / 3) * 4 + 32;

/**
 * How a connected-mode note refers to an image in the attachment store of the
 * server, not inline: `attachment:` and the ULID of the attachment. The server
 * changes each inline image that it gets into one of these (see
 * `docs/specification/features/attachments.md`), and serves the bytes at `GET
 * /api/v1/attachments/:id`. Open mode never has one, and an export never
 * contains one. Both inline the bytes again.
 */
export const ATTACHMENT_REF_PREFIX = "attachment:";

export const ATTACHMENT_REF_PATTERN = /^attachment:[0-9A-HJKMNP-TV-Z]{26}$/;

export function isAttachmentRef(image: string): boolean {
  return ATTACHMENT_REF_PATTERN.test(image);
}

/**
 * How an open-mode note refers to an image in the IndexedDB of this browser:
 * `local:` and the SHA-256 of its bytes, in hex. The app never sends it to a
 * server. An export inlines the bytes.
 */
export const LOCAL_IMAGE_REF_PREFIX = "local:";

export const LOCAL_IMAGE_REF_PATTERN = /^local:[0-9a-f]{64}$/;

export function isLocalImageRef(image: string): boolean {
  return LOCAL_IMAGE_REF_PATTERN.test(image);
}

/** If an image is a reference (either type), not inline bytes. */
export function isStoredImageRef(image: string): boolean {
  return isAttachmentRef(image) || isLocalImageRef(image);
}

/** The attachment id that a reference names. */
export function attachmentIdOf(ref: string): string {
  return ref.slice(ATTACHMENT_REF_PREFIX.length);
}

/** The maximum number of images that you can attach to one note. */
export const MAX_IMAGES_PER_NOTE = 20;

/** The maximum length of the description of an image, in UTF-16 units. */
export const MAX_IMAGE_ALT_LENGTH = 1000;

/**
 * Matches an accepted image data URL. It is anchored at both ends, and the
 * base64 payload can contain only the base64 alphabet. Thus, a `data:` URL
 * cannot hide a second scheme after the prefix check.
 */
export const IMAGE_DATA_URL_PATTERN = new RegExp(
  `^data:image/(?:${IMAGE_DATA_URL_SUBTYPES.join("|")});base64,[A-Za-z0-9+/]+={0,2}$`,
  "i",
);

export const REMINDER_RECURRENCES = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const;

export type ReminderRecurrence = (typeof REMINDER_RECURRENCES)[number];

export interface NoteReminder {
  /** ISO 8601 local wall-clock time of the next fire of the reminder. */
  time: string;
  recurrence: ReminderRecurrence;
  /**
   * The day of the month on which a monthly or yearly reminder repeats. It is
   * present only while `time` shows a different day. A reminder set for the
   * 31st fires on the 28th in February, and must still go back to the 31st in
   * March.
   */
  day?: number;
  /**
   * The IANA timezone, recorded at creation, so that DST and travel are
   * predictable.
   */
  timezone: string;
  /**
   * ISO time of the last real fire. Tabs and the service worker use it to
   * prevent duplicates.
   */
  lastFiredAt?: string;
  /**
   * An urgent reminder does not move on when it fires. Its notification stays
   * until the user dismisses it, and it fires again each `URGENT_REPEAT_MS`
   * until the user marks it done (`reminderDone`). Present only as `true`.
   */
  urgent?: true;
}

/** Identifies a note that a plugin made. The user did not write it. */
export interface AutoNoteSource {
  kind: "auto-note";
  pluginId: string;
  /** A stable sub-id when a plugin returns many notes. The default is "". */
  noteKey: string;
}

/** What a recipient can do with a note shared with them. */
export const SHARE_ROLES = ["edit", "view"] as const;

export type ShareRole = (typeof SHARE_ROLES)[number];

/** The relation of the signed-in user to a note. */
export type NoteRole = "owner" | ShareRole;

/** A different account, as sharing shows it. */
export interface ShareUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
}

/** A person with whom a note is shared. */
/** A team as a note or an invitation names it. */
export interface TeamRef {
  id: string;
  name: string;
}

export interface NoteMember extends ShareUser {
  role: ShareRole;
  /**
   * False while the invitation waits for an answer. Only the owner sees those.
   * All other persons see the people who accepted.
   */
  accepted: boolean;
  /**
   * The team through which this person has the note. Absent when the note is
   * shared with them directly.
   */
  team?: TeamRef;
  /**
   * True while nobody wrapped the key of the note for this person. Thus, they
   * can open nothing of it yet. The first client of a person who has the note
   * wraps it for them.
   */
  waitingForKey?: boolean;
}

/**
 * With whom a note is shared, and with which rights, as the reader sees it.
 * Present only in connected mode, and only on a note shared with one or more
 * other persons.
 */
export interface NoteSharing {
  role: NoteRole;
  owner: ShareUser;
  /** All persons other than the owner. */
  members: NoteMember[];
}

/**
 * The fields that all participants see the same. All other parts of a note
 * (color, pin, archive, trash, position, tags, reminder) belong to each person.
 */
export const SHARED_NOTE_FIELDS = [
  "title",
  "content",
  "font",
  "images",
  "imageAlts",
  "linkPreviews",
] as const;

/**
 * The fields that a recipient keeps for themselves, whatever their role. The
 * trash is one of them. Delete by a recipient puts the note in their own trash.
 * The trash of the owner hides the note from all persons.
 */
export const PERSONAL_NOTE_FIELDS = [
  "color",
  "pinned",
  "archived",
  "trashed",
  "trashedAt",
  "position",
  "tags",
  "reminder",
] as const;

export interface Note {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  font: NoteFont;
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  trashedAt: string | null;
  position: number;
  tags: string[];
  /**
   * Attached images: `data:` URLs, or in connected mode `attachment:<id>`
   * references to the attachment store of the server (`isAttachmentRef`). The
   * server stores and sends back these references. Empty on a note from a list
   * endpoint, also when it has attachments. Compare with `imageCount`. Do not
   * read an empty list as "no images". Call `ensureImages` of the client before
   * you do anything that needs the bytes.
   */
  images: string[];
  /**
   * What each image shows, in words, for a person who cannot see it: its `alt`,
   * in the order of `images`, with "" (or no entry) for an image that has no
   * description. Absent on a note where no image has a description. All code
   * that writes `images` keeps it aligned (`carriedImageAlts`). A sealed note
   * puts each description inside the entry of its image. Thus, it goes wherever
   * the image goes.
   */
  imageAlts?: string[];
  /**
   * The number of images of the note, whether `images` is loaded or not. The
   * server sets it. Absent in open mode, where `images` is always complete and
   * its length is the answer.
   */
  imageCount?: number;
  linkPreviews: LinkPreview[];
  reminder: NoteReminder | null;
  createdAt: string;
  updatedAt: string;
  /** Generated notes that a plugin made. You cannot edit them. */
  readonly?: boolean;
  /** The origin of a generated note. */
  source?: AutoNoteSource;
  /**
   * Who else has this note. The server sets it, and never accepts it from a
   * client. Absent in open mode, and on a note to which nobody else was
   * invited.
   */
  sharing?: NoteSharing;
}

/**
 * What the signed-in user can do with a note. In open mode, the user owns all.
 */
export function roleOf(note: Pick<Note, "sharing">): NoteRole {
  return note.sharing?.role ?? "owner";
}

/**
 * The number of images of a note, from either mode. `imageCount` is what a list
 * endpoint sends in place of the bytes. `images.length` is the answer in all
 * places where the images were never removed.
 */
export function imageCountOf(
  note: Pick<Note, "images" | "imageCount">,
): number {
  return note.imageCount ?? note.images.length;
}

/** The description of each image, one for each image: "" where it has none. */
export function imageAltsOf(
  note: Pick<Note, "images" | "imageAlts">,
): string[] {
  return note.images.map((_, i) => note.imageAlts?.[i] ?? "");
}

/**
 * The descriptions that `before` gave its images, moved to `images`. An image
 * keeps its own description where it moved, and a new image has none. Empty
 * when none of them has one, which is what a note without descriptions
 * contains.
 */
export function carriedImageAlts(
  before: Pick<Note, "images" | "imageAlts">,
  images: readonly string[],
): string[] {
  const byImage = new Map<string, string>();
  for (const [i, image] of before.images.entries()) {
    const alt = before.imageAlts?.[i];
    if (alt && !byImage.has(image)) byImage.set(image, alt);
  }
  const alts = images.map((image) => byImage.get(image) ?? "");
  return alts.some((alt) => alt !== "") ? alts : [];
}

/** If this note has attachments whose bytes did not load yet. */
export function hasUnloadedImages(
  note: Pick<Note, "images" | "imageCount">,
): boolean {
  return imageCountOf(note) > note.images.length;
}

/**
 * The fields that a new note accepts (the server sets the id and the
 * timestamps). `imageCount` comes from `images`, and is never sent.
 */
export type NoteCreate = Omit<
  Note,
  "id" | "createdAt" | "updatedAt" | "imageCount" | "sharing"
>;

/** A partial update: only the fields that change. */
export type NoteUpdate = Partial<
  Omit<Note, "id" | "createdAt" | "imageCount" | "sharing">
>;

/** The version history of a note keeps a maximum of this many versions... */
export const MAX_NOTE_VERSIONS = 50;
/** ...and none older than this, in both modes. */
export const NOTE_VERSION_MAX_AGE_DAYS = 90;

/** How long a note stays in the trash before its permanent deletion. */
export const TRASH_RETENTION_DAYS = 30;

/**
 * A snapshot of the title, the content and the images of a note at one time.
 * A version from before the images were kept has no `images`. A restore of it
 * keeps the images that the note has.
 */
export interface NoteVersion {
  noteId: string;
  timestamp: string;
  title: string;
  content: string;
  images?: string[];
  /** Aligned with `images`, as on a note. */
  imageAlts?: string[];
}
