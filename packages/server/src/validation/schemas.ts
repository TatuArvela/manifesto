import { NoteColor, NoteFont } from "@manifesto/shared";
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
 * Only http(s) URLs are accepted for any user-provided URL field. This blocks
 * `javascript:`, `data:`, `file:`, and arbitrary internal-scheme URLs that
 * could otherwise be used to fingerprint or SSRF-probe a recipient's network
 * when a note is shared via /share/...
 */
const httpUrlSchema = z
  .string()
  .url()
  .max(2048)
  .regex(/^https?:\/\//i, "URL must use http(s) scheme");

const linkPreviewSchema = z.object({
  url: httpUrlSchema,
  title: z.string().max(500),
  description: z.string().max(2000).optional(),
  image: httpUrlSchema.optional(),
  favicon: httpUrlSchema.optional(),
  domain: z.string().max(255),
});

const reminderRecurrenceSchema = z.enum([
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

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
  images: z.array(httpUrlSchema).max(20),
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
