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
   * A small thumbnail, held like a note's `images`: an `attachment:` reference
   * in connected mode, `local:` in open mode, and a `data:` URL only in an
   * export or an import on its way in. Never the linked site's own URL.
   */
  image?: string;
  /** The site's icon, held the same way. */
  favicon?: string;
  domain: string;
}

/** Every image the previews hold: each thumbnail and favicon. */
export function previewImages(previews: readonly LinkPreview[]): string[] {
  const out: string[] = [];
  for (const preview of previews) {
    if (preview.image) out.push(preview.image);
    if (preview.favicon) out.push(preview.favicon);
  }
  return out;
}

/**
 * The previews with each thumbnail and favicon passed through `map`, in
 * order; `undefined` from `map` drops that image and keeps the card.
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

/** Maximum number of link previews on one note. */
export const MAX_LINK_PREVIEWS_PER_NOTE = 20;

/** Longest URL a link preview may point at. */
export const MAX_LINK_PREVIEW_URL_LENGTH = 2048;

/**
 * Cap on a preview thumbnail or favicon, measured on the encoded `data:` URL
 * the client draws it to before storing it. A card shows either at a few dozen
 * pixels, so the client shrinks what the server fetched to fit this rather
 * than storing the page's full-size image.
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
 * Largest image stored, after the client has shrunk it (`shrinkImage` keeps a
 * photo at 2560 pixels on its long edge, which is well under this). It is the
 * ceiling for what is not shrunk: a large screenshot, an animated GIF, an API
 * client uploading as it likes. The error messages quote it through
 * `formatFileSize` ("5 MB", "5 Mt").
 *
 * 5 MiB rather than a round 5,000,000 because the platforms disagree about
 * what "MB" means and this is the reading that never rejects a file the user
 * was told would fit: Windows labels MiB as MB, so a file it displays as
 * "5.00 MB" is exactly this and is accepted, while macOS shows the same file
 * as 5.24 MB, which merely admits slightly more than advertised.
 */
export const MAX_IMAGE_SOURCE_BYTES = 5 * 1024 * 1024;

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

/**
 * How a connected-mode note refers to an image held in the server's
 * attachment store rather than inline: `attachment:` and the attachment's
 * ULID. The server turns every inline image it is sent into one of these
 * (see `docs/specification/features/attachments.md`), and serves the bytes at
 * `GET /api/attachments/:id`. Open mode never holds one, and an export never
 * contains one: both inline the bytes again.
 */
export const ATTACHMENT_REF_PREFIX = "attachment:";

export const ATTACHMENT_REF_PATTERN = /^attachment:[0-9A-HJKMNP-TV-Z]{26}$/;

export function isAttachmentRef(image: string): boolean {
  return ATTACHMENT_REF_PATTERN.test(image);
}

/**
 * How an open-mode note refers to an image kept in this browser's IndexedDB:
 * `local:` and the SHA-256 of its bytes, in hex. Never sent to a server; an
 * export inlines the bytes instead.
 */
export const LOCAL_IMAGE_REF_PREFIX = "local:";

export const LOCAL_IMAGE_REF_PATTERN = /^local:[0-9a-f]{64}$/;

export function isLocalImageRef(image: string): boolean {
  return LOCAL_IMAGE_REF_PATTERN.test(image);
}

/** Whether an image is a reference (either kind) rather than inline bytes. */
export function isStoredImageRef(image: string): boolean {
  return isAttachmentRef(image) || isLocalImageRef(image);
}

/** The attachment id a reference names. */
export function attachmentIdOf(ref: string): string {
  return ref.slice(ATTACHMENT_REF_PREFIX.length);
}

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

/** What a recipient may do with a note shared with them. */
export const SHARE_ROLES = ["edit", "view"] as const;

export type ShareRole = (typeof SHARE_ROLES)[number];

/** The signed-in user's relationship to a note. */
export type NoteRole = "owner" | ShareRole;

/** Another account, as sharing shows it. */
export interface ShareUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
}

/** Someone a note is shared with. */
export interface NoteMember extends ShareUser {
  role: ShareRole;
  /**
   * False while the invitation waits for an answer. Only the owner is told
   * about those; everyone else sees the people who accepted.
   */
  accepted: boolean;
}

/**
 * Who a note is shared with, and on what terms, from the point of view of
 * whoever is reading it. Present only in connected mode and only on a note
 * shared with at least one other person.
 */
export interface NoteSharing {
  role: NoteRole;
  owner: ShareUser;
  /** Everyone but the owner. */
  members: NoteMember[];
}

/**
 * The fields every participant sees alike. Everything else about a note
 * (color, pin, archive, trash, position, tags, reminder) is each person's own.
 */
export const SHARED_NOTE_FIELDS = [
  "title",
  "content",
  "font",
  "images",
  "linkPreviews",
] as const;

/**
 * The fields a recipient keeps for themselves, whatever their role. The
 * trash is among them: a recipient's Delete puts the note in their own trash,
 * while the owner's trash hides the note from everyone.
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
   * references to the server's attachment store (`isAttachmentRef`), which
   * is what the server stores and sends back. Empty on a note that came from a list
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
  /**
   * Who else has this note. Set by the server and never accepted from a
   * client; absent in open mode and on a note nobody else has been invited to.
   */
  sharing?: NoteSharing;
}

/** What the signed-in user may do with a note: open mode owns everything. */
export function roleOf(note: Pick<Note, "sharing">): NoteRole {
  return note.sharing?.role ?? "owner";
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
  "id" | "createdAt" | "updatedAt" | "imageCount" | "sharing"
>;

/** Partial update: only the fields being changed. */
export type NoteUpdate = Partial<
  Omit<Note, "id" | "createdAt" | "imageCount" | "sharing">
>;

/** A snapshot of a note's title and content at a point in time. */
/** A note's version history keeps at most this many versions... */
export const MAX_NOTE_VERSIONS = 50;
/** ...none older than this, in both modes. */
export const NOTE_VERSION_MAX_AGE_DAYS = 90;

export interface NoteVersion {
  noteId: string;
  timestamp: string;
  title: string;
  content: string;
}
