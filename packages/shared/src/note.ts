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
  image?: string;
  favicon?: string;
  domain: string;
}

/**
 * Image subtypes accepted in `Note.images`.
 *
 * Attached images are inlined as `data:` URLs rather than uploaded, so this
 * list is a security boundary, not a convenience: `data:` is a same-origin
 * scheme, and admitting `data:text/html` or `data:image/svg+xml` would let a
 * note carry executable markup into any surface that renders an attachment by
 * URL. SVG is excluded for exactly that reason — it is a document format that
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
 * Per-image cap, measured on the encoded `data:` URL — the form that actually
 * crosses the wire and sits in the note row. Base64 inflates by about a third,
 * so this admits roughly a 1.5 MB source image.
 *
 * Client, server and specification all read this constant. The whole note is
 * additionally bounded by the request body limit in the server's `app.ts`,
 * which is what stops twenty images at the cap from adding up to a 40 MB write.
 */
export const MAX_IMAGE_DATA_URL_BYTES = 2 * 1024 * 1024;

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
  images: string[];
  linkPreviews: LinkPreview[];
  reminder: NoteReminder | null;
  createdAt: string;
  updatedAt: string;
  /** Generated, non-editable notes produced by a plugin. */
  readonly?: boolean;
  /** Origin of a generated note. */
  source?: AutoNoteSource;
}

/** Fields accepted when creating a note (server assigns id and timestamps). */
export type NoteCreate = Omit<Note, "id" | "createdAt" | "updatedAt">;

/** Partial update — only the fields being changed. */
export type NoteUpdate = Partial<Omit<Note, "id" | "createdAt">>;

/** A snapshot of a note's title and content at a point in time. */
export interface NoteVersion {
  noteId: string;
  timestamp: string;
  title: string;
  content: string;
}
