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

const linkPreviewSchema = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string().optional(),
  image: z.string().optional(),
  favicon: z.string().optional(),
  domain: z.string(),
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

const noteFields = {
  title: z.string(),
  content: z.string(),
  color: noteColorSchema,
  font: noteFontSchema,
  pinned: z.boolean(),
  archived: z.boolean(),
  trashed: z.boolean(),
  trashedAt: z.string().nullable(),
  position: z.number(),
  tags: z.array(z.string()),
  images: z.array(z.string()),
  linkPreviews: z.array(linkPreviewSchema),
  reminder: reminderSchema.nullable(),
  readonly: z.boolean().optional(),
  source: autoNoteSourceSchema.optional(),
} as const;

export const noteCreateSchema = z.object(noteFields);
export const noteUpdateSchema = z.object(noteFields).partial();

export const searchParamsSchema = z.object({
  q: z.string(),
});
