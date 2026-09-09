import {
  IMAGE_DATA_URL_PATTERN,
  MAX_IMAGE_DATA_URL_BYTES,
  MAX_IMAGE_SOURCE_BYTES,
  MAX_IMAGES_PER_NOTE,
  NoteColor,
  NoteFont,
  REMINDER_RECURRENCES,
} from "@manifesto/shared";
import { z } from "zod";

export const authCredentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Username is required")
    .max(64, "Username is too long"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(256, "Password is too long"),
});

export const noteColorSchema = z.nativeEnum(NoteColor);
export const noteFontSchema = z.nativeEnum(NoteFont);

/**
 * Only http(s) URLs are accepted for the link-preview fields — the ones a
 * renderer will dereference. This blocks `javascript:`, `data:`, `file:`, and
 * arbitrary internal-scheme URLs that could otherwise be used to fingerprint or
 * SSRF-probe a recipient's network when a note is shared via /share/...
 *
 * `Note.images` is deliberately not one of these; see `imageDataUrlSchema`.
 */
const httpUrlSchema = z
  .string()
  .url()
  .max(2048)
  .regex(/^https?:\/\//i, "URL must use http(s) scheme");

/**
 * Attached images are inlined by the client as `data:` URLs, so they cannot go
 * through `httpUrlSchema` — that schema exists to keep remote-fetching fields
 * (link previews) from being pointed at internal hosts, a concern a `data:` URL
 * does not have. What matters here instead is that the payload is inert image
 * bytes and that one note cannot carry an unbounded write.
 */
const imageDataUrlSchema = z
  .string()
  .max(
    MAX_IMAGE_DATA_URL_BYTES,
    // Derived, so the number a client sees can never drift from the one
    // enforced. This message is not localized — the client refuses over-cap
    // images before sending, and localizes its own.
    `Image is too large; attach an image under ${
      MAX_IMAGE_SOURCE_BYTES / (1024 * 1024)
    } MB`,
  )
  .regex(
    IMAGE_DATA_URL_PATTERN,
    "Image must be a PNG, JPEG, GIF, WebP or AVIF data URL",
  );

const linkPreviewSchema = z.object({
  url: httpUrlSchema,
  title: z.string().max(500),
  description: z.string().max(2000).optional(),
  image: httpUrlSchema.optional(),
  favicon: httpUrlSchema.optional(),
  domain: z.string().max(255),
});

const reminderRecurrenceSchema = z.enum(REMINDER_RECURRENCES);

const reminderSchema = z.object({
  time: z.string(),
  recurrence: reminderRecurrenceSchema,
  timezone: z.string(),
  lastFiredAt: z.string().optional(),
});

const autoNoteSourceSchema = z.object({
  kind: z.literal("auto-note"),
  pluginId: z.string(),
  noteKey: z.string(),
});

// Per-field caps. The 1 MiB request-body cap is a backstop, but without
// per-field limits a single authenticated user can fill the listByUser
// payload with multi-MB notes and OOM the server. The numbers are generous
// for normal use but reject obviously-pathological inputs.
const noteFields = {
  title: z.string().max(500),
  content: z.string().max(100_000),
  color: noteColorSchema,
  font: noteFontSchema,
  pinned: z.boolean(),
  archived: z.boolean(),
  trashed: z.boolean(),
  trashedAt: z.string().nullable(),
  position: z.number(),
  tags: z.array(z.string().min(1).max(64)).max(50),
  images: z.array(imageDataUrlSchema).max(MAX_IMAGES_PER_NOTE),
  linkPreviews: z.array(linkPreviewSchema).max(20),
  reminder: reminderSchema.nullable(),
  readonly: z.boolean().optional(),
  source: autoNoteSourceSchema.optional(),
} as const;

export const noteCreateSchema = z.object(noteFields);
export const noteUpdateSchema = z.object(noteFields).partial();

export const searchParamsSchema = z.object({
  q: z.string(),
});
