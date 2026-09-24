import {
  ATTACHMENT_REF_PATTERN,
  IMAGE_DATA_URL_PATTERN,
  MAX_IMAGES_PER_NOTE,
  MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES,
  MAX_LINK_PREVIEW_URL_LENGTH,
  MAX_LINK_PREVIEWS_PER_NOTE,
  NoteColor,
  NoteFont,
  REMINDER_RECURRENCES,
  SHARE_ROLES,
  WEBHOOK_EVENTS,
} from "@manifesto/shared";
import { z } from "zod";

const usernameSchema = z
  .string()
  .trim()
  .min(1, "Username is required")
  .max(64, "Username is too long");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(256, "Password is too long");

/**
 * An email address, checked only for its shape: something, an `@`, something.
 * Nothing is ever sent to it, so what matters is that it names one person and
 * can be typed back to find them, not that a mail server would accept it.
 */
export const emailSchema = z
  .string()
  .trim()
  .min(3, "Email is required")
  .max(254, "Email is too long")
  .regex(/^[^\s@]+@[^\s@]+$/, "Email must look like name@example.com");

export const authCredentialsSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export const registerSchema = authCredentialsSchema.extend({
  email: emailSchema.optional(),
});

export const authMeUpdateSchema = z.object({ email: emailSchema.nullable() });

export const loginSchema = authCredentialsSchema.extend({
  newPassword: passwordSchema.optional(),
  /** An authenticator code, or a recovery code, when two-factor is on. */
  otp: z.string().trim().min(1).max(32).optional(),
});

/** Re-entering the password guards the two-factor switches: a session left
 * open on a shared computer must not be enough to turn it off. */
export const twoFactorPasswordSchema = z.object({
  password: z.string().max(256),
});

export const twoFactorEnableSchema = z.object({
  code: z.string().trim().min(6).max(10),
});

export const passwordChangeSchema = z.object({
  // Only compared with the stored hash, so it is held to the length cap and
  // not to today's rules, which an older password may predate.
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});

export const adminCreateUserSchema = z.object({
  username: usernameSchema,
  email: emailSchema.optional(),
});

export const adminUpdateUserSchema = z
  .object({
    isAdmin: z.boolean().optional(),
    email: emailSchema.nullable().optional(),
  })
  .refine((body) => body.isAdmin !== undefined || body.email !== undefined, {
    message: "Nothing to change",
  });

const shareRoleSchema = z.enum(SHARE_ROLES);

export const shareCreateSchema = z.object({
  userId: z.string().min(1).max(64),
  role: shareRoleSchema,
});

export const shareUpdateSchema = z.object({ role: shareRoleSchema });

export const noteColorSchema = z.nativeEnum(NoteColor);
export const noteFontSchema = z.nativeEnum(NoteFont);

/**
 * Only http(s) URLs are accepted for the link-preview fields, the ones a
 * renderer will dereference. This blocks `javascript:`, `data:`, `file:`, and
 * arbitrary internal-scheme URLs that could otherwise be used to fingerprint or
 * SSRF-probe a recipient's network when a note is shared via /share/...
 *
 * `Note.images` is not one of these: it holds `attachment:` references.
 */
const httpUrlSchema = z
  .string()
  .url()
  .max(MAX_LINK_PREVIEW_URL_LENGTH)
  .regex(/^https?:\/\//i, "URL must use http(s) scheme");

/**
 * A preview's thumbnail or favicon. The client stores a small inlined copy, so
 * viewing a note never makes the viewer's browser contact the linked site (and
 * the client's CSP would refuse a remote image anyway). An http(s) URL is still
 * accepted so a row written before previews were inlined stays updatable.
 */
const previewImageSchema = z.union([
  z
    .string()
    .max(MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES)
    .regex(IMAGE_DATA_URL_PATTERN),
  httpUrlSchema,
]);

export const MAX_LINK_PREVIEW_TITLE_LENGTH = 500;
export const MAX_LINK_PREVIEW_DESCRIPTION_LENGTH = 2000;

const linkPreviewSchema = z.object({
  url: httpUrlSchema,
  title: z.string().max(MAX_LINK_PREVIEW_TITLE_LENGTH),
  description: z.string().max(MAX_LINK_PREVIEW_DESCRIPTION_LENGTH).optional(),
  image: previewImageSchema.optional(),
  favicon: previewImageSchema.optional(),
  domain: z.string().max(255),
});

/** The query of `GET /api/link-preview`. */
export const linkPreviewQuerySchema = z.object({ url: httpUrlSchema });

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
  // `trashedAt` is deliberately absent: it drives hard deletion 30 days on,
  // so a client that could set it could also ask for a note to be destroyed
  // immediately, or never. The routes stamp it from `trashed` and the
  // server clock, and zod strips whatever a client sends.
  position: z.number(),
  tags: z.array(z.string().min(1).max(64)).max(50),
  // References from `POST /api/attachments`; the bytes never ride in a note.
  images: z
    .array(z.string().regex(ATTACHMENT_REF_PATTERN, "Upload images first"))
    .max(MAX_IMAGES_PER_NOTE),
  linkPreviews: z.array(linkPreviewSchema).max(MAX_LINK_PREVIEWS_PER_NOTE),
  reminder: reminderSchema.nullable(),
  readonly: z.boolean().optional(),
  source: autoNoteSourceSchema.optional(),
} as const;

export const noteCreateSchema = z.object(noteFields);

/** `POST /api/notes/:id/versions`: the same bounds as the note's own text. */
export const noteVersionCreateSchema = z.object({
  title: noteFields.title,
  content: noteFields.content,
  timestamp: z.string().max(40).optional(),
});
export const noteUpdateSchema = z.object(noteFields).partial();

/** `POST /api/tokens`. */
export const apiTokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

/** `POST /api/webhooks`. Where it may point is checked on every delivery,
 * against the resolved address; this only refuses what is never a webhook. */
export const webhookCreateSchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .regex(/^https?:\/\//i, "URL must use http(s) scheme"),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1)
    .max(WEBHOOK_EVENTS.length)
    .optional(),
});

/** `PUT /api/webhooks/:id`. */
export const webhookUpdateSchema = z.object({ active: z.boolean() });

/** `POST /api/auth/password-reset`. `locale` picks the mail's language. */
export const passwordResetRequestSchema = z.object({
  email: emailSchema,
  locale: z.string().max(10).optional(),
});

/** `POST /api/auth/password-reset/confirm`. */
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
