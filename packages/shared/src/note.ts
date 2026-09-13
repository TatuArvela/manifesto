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
  PermanentMarker = "permanent-marker",
  ComicRelief = "comic-relief",
}

export interface LinkPreview {
  url: string;
  title: string;
  description?: string;
  /** A small inlined thumbnail, as an image `data:` URL. */
  image?: string;
  /** The site's icon, inlined the same way. */
  favicon?: string;
  domain: string;
}

/** Maximum number of link previews on one note. */
export const MAX_LINK_PREVIEWS_PER_NOTE = 20;

/** Longest URL a link preview may point at. */
export const MAX_LINK_PREVIEW_URL_LENGTH = 2048;

/**
 * Cap on a stored preview thumbnail or favicon, measured on the encoded
 * `data:` URL. Previews travel with every note in a listing, unlike
 * attachments, so the client shrinks what the server fetched to fit this
 * rather than storing the page's full-size image.
 */
export const MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES = 64 * 1024;

/**
 * Image subtypes accepted in `Note.images`.
 *
 * Attached images are inlined as `data:` URLs rather than uploaded, so this
 * list is a security boundary, not a convenience: `data:` is a same-origin
 * scheme, and admitting `data:text/html` or `data:image/svg+xml` would let a
 * note carry executable markup into any surface that renders an attachment by
 * URL. SVG is excluded for exactly that reason: it is a document format that
 * happens to be an image.
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
 * Largest source image a user may attach. This is the number the error messages
 * quote ("1.5 MB" in `en.ts`, "1,5 Mt" in `fi.ts`), so the two must move
 * together.
 *
 * 1.5 MiB rather than a round 1,500,000 because the platforms disagree about
 * what "MB" means and this is the reading that never rejects a file the user
 * was told would fit: Windows labels MiB as MB, so a file it displays as
 * "1.50 MB" is exactly this and is accepted, while macOS shows the same file as
 * 1.57 MB, which merely admits slightly more than advertised.
 */
export const MAX_IMAGE_SOURCE_BYTES = 1.5 * 1024 * 1024;

/**
 * The same cap expressed on the encoded `data:` URL, which is the form that
 * actually crosses the wire and sits in the note row, and therefore the form
 * worth bounding. Derived rather than written down: base64 emits 4 characters
 * per 3 bytes, and the `data:image/…;base64,` prefix counts toward the limit
 * too, at 23 characters for the longest of the accepted media types, which is
 * enough to push a file of exactly MAX_IMAGE_SOURCE_BYTES over a hand-rounded
 * cap and reject it 18 bytes short of the advertised number.
 *
 * The whole note is additionally bounded by the request body limit in the
 * server's `app.ts`, which is what stops twenty images each individually under
 * this cap from adding up to a 40 MB write.
 */
export const MAX_IMAGE_DATA_URL_BYTES =
  Math.ceil(MAX_IMAGE_SOURCE_BYTES / 3) * 4 + 32;

/** Maximum number of images attachable to one note. */
export const MAX_IMAGES_PER_NOTE = 20;

/**
 * Matches an accepted image data URL. Anchored at both ends, with the base64
 * payload constrained to the base64 alphabet so a `data:` URL cannot smuggle a
 * second scheme past the prefix check.
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
  /** ISO 8601 local-wall-clock datetime when the reminder next fires. */
  time: string;
  recurrence: ReminderRecurrence;
  /** IANA timezone captured at creation so DST/travel behaves predictably. */
  timezone: string;
  /** ISO of the last real fire; used for cross-tab / service-worker dedupe. */
  lastFiredAt?: string;
}

/** Identifies a note that wasn't authored by the user but produced by a plugin. */
export interface AutoNoteSource {
  kind: "auto-note";
  pluginId: string;
  /** Stable sub-id when a plugin returns multiple notes; defaults to "" */
  noteKey: string;
}

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
   * Attached images as `data:` URLs. Empty on a note that came from a list
   * endpoint even when it has attachments. Compare with `imageCount` rather
   * than reading emptiness as "no images", and call the client's
   * `ensureImages` before doing anything that needs the bytes.
   */
  images: string[];
  /**
   * How many images the note has, whether or not `images` is loaded. Set by
   * the server; absent in open mode, where `images` is always complete and
   * its length is the answer.
   */
  imageCount?: number;
  linkPreviews: LinkPreview[];
  reminder: NoteReminder | null;
  createdAt: string;
  updatedAt: string;
  /** Generated, non-editable notes produced by a plugin. */
  readonly?: boolean;
  /** Origin of a generated note. */
  source?: AutoNoteSource;
}

/**
 * How many images a note has, whichever mode it came from. `imageCount` is
 * what a list endpoint sends instead of the bytes; `images.length` is the
 * answer everywhere it was never stripped.
 */
export function imageCountOf(
  note: Pick<Note, "images" | "imageCount">,
): number {
  return note.imageCount ?? note.images.length;
}

/** Whether this note has attachments whose bytes have not been fetched yet. */
export function hasUnloadedImages(
  note: Pick<Note, "images" | "imageCount">,
): boolean {
  return imageCountOf(note) > note.images.length;
}

/**
 * Fields accepted when creating a note (server assigns id and timestamps).
 * `imageCount` is derived from `images`, never sent.
 */
export type NoteCreate = Omit<
  Note,
  "id" | "createdAt" | "updatedAt" | "imageCount"
>;

/** Partial update: only the fields being changed. */
export type NoteUpdate = Partial<Omit<Note, "id" | "createdAt" | "imageCount">>;

/** A snapshot of a note's title and content at a point in time. */
export interface NoteVersion {
  noteId: string;
  timestamp: string;
  title: string;
  content: string;
}
