import {
  ATTACHMENT_REF_PATTERN,
  MAX_ATTACHMENTS_PER_CLAIM,
  MAX_COMMENT_LENGTH,
  MAX_IMAGES_PER_NOTE,
  MAX_LINK_PREVIEW_DESCRIPTION_LENGTH,
  MAX_LINK_PREVIEW_TITLE_LENGTH,
  MAX_LINK_PREVIEW_URL_LENGTH,
  MAX_LINK_PREVIEWS_PER_NOTE,
  MAX_NOTE_CONTENT_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  MAX_NOTES_PER_IMPORT,
  MAX_PREVIOUS_KEYS_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_NOTE,
  MAX_WRAPPED_KEY_LENGTH,
  NoteColor,
  NoteFont,
  REMINDER_RECURRENCES,
  SEALED_FIELD_MAX,
} from "@manifesto/shared";
import { z } from "zod";
import {
  exactPartial,
  noteIdSchema,
  sealed,
  sealedOrEmpty,
  wrappedKey,
} from "./fields.ts";

// Request bodies of notes: as a token sends them, readable, and as the app
// sends them, sealed; with their versions, attachments and comments.

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
 * A preview's thumbnail or favicon: a reference from `POST /api/v1/attachments`,
 * like `images`, so previews add nothing to a listing but their text. Viewing
 * a note never makes the viewer's browser contact the linked site (and the
 * client's CSP would refuse a remote image anyway). An http(s) URL is still
 * accepted so a row written before previews were stored stays updatable.
 */
const previewImageSchema = z.union([
  z.string().regex(ATTACHMENT_REF_PATTERN, "Upload preview images first"),
  httpUrlSchema,
]);

const linkPreviewSchema = z
  .object({
    url: httpUrlSchema,
    title: z.string().max(MAX_LINK_PREVIEW_TITLE_LENGTH),
    description: z
      .string()
      .max(MAX_LINK_PREVIEW_DESCRIPTION_LENGTH)
      .exactOptional(),
    image: previewImageSchema.exactOptional(),
    favicon: previewImageSchema.exactOptional(),
    domain: z.string().max(255),
  })
  // The card shows `domain` as where the link goes, so it is always the
  // URL's own host, whatever was sent: a writer could otherwise have a card
  // name one site and open another, on a shared note or a public link.
  .transform((preview) => ({ ...preview, domain: hostOf(preview.url) }));

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** The query of `GET /api/v1/link-preview`. */
export const linkPreviewQuerySchema = z.object({ url: httpUrlSchema });

const reminderRecurrenceSchema = z.enum(REMINDER_RECURRENCES);

// Bounded like every other field of a note: these ride in each listing, so
// an uncapped one is a megabyte per note there. A timestamp and an IANA zone
// name are short; a plugin's key for a note is its own text.
const reminderSchema = z.object({
  time: z.string().max(40),
  recurrence: reminderRecurrenceSchema,
  day: z.number().int().min(1).max(31).exactOptional(),
  timezone: z.string().max(64),
  lastFiredAt: z.string().max(40).exactOptional(),
});

const autoNoteSourceSchema = z.object({
  kind: z.literal("auto-note"),
  pluginId: z.string().max(64),
  noteKey: z.string().max(500),
});

// Per-field caps. The 1 MiB request-body cap is a backstop, but without
// per-field limits a single authenticated user can fill the listByUser
// payload with multi-MB notes and OOM the server. The numbers are generous
// for normal use but reject obviously-pathological inputs.
const noteFields = {
  title: z.string().max(MAX_NOTE_TITLE_LENGTH),
  content: z.string().max(MAX_NOTE_CONTENT_LENGTH),
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
  tags: z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_NOTE),
  // References from `POST /api/v1/attachments`; the bytes never ride in a note.
  images: z
    .array(z.string().regex(ATTACHMENT_REF_PATTERN, "Upload images first"))
    .max(MAX_IMAGES_PER_NOTE),
  linkPreviews: z.array(linkPreviewSchema).max(MAX_LINK_PREVIEWS_PER_NOTE),
  reminder: reminderSchema.nullable(),
  readonly: z.boolean().exactOptional(),
  source: autoNoteSourceSchema.exactOptional(),
} as const;

export const noteCreateSchema = z.object(noteFields);

/** `POST /api/v1/notes/import`: notes as created, with the id and creation time
 * they had where they came from. */
export const notesImportSchema = z.object({
  notes: z
    .array(
      noteCreateSchema.extend({
        id: z
          .string()
          .regex(/^[0-9A-Za-z_-]{1,64}$/)
          .exactOptional(),
        createdAt: z.iso.datetime({ offset: true }).exactOptional(),
      }),
    )
    .max(MAX_NOTES_PER_IMPORT),
});

/** `POST /api/v1/notes/:id/versions`: the same bounds as the note's own text. */
export const noteVersionCreateSchema = z.object({
  title: noteFields.title,
  content: noteFields.content,
  timestamp: z.string().max(40).exactOptional(),
});
export const noteUpdateSchema = z.object(exactPartial(noteFields));

// The same requests from the app, whose notes are sealed before they leave
// the browser. Every value in someone's words is a ciphertext; what the
// server acts on stays as it was.

const attachmentRefs = (max: number) =>
  z
    .array(z.string().regex(ATTACHMENT_REF_PATTERN, "Upload images first"))
    .max(max);

const sealedNoteFields = {
  title: sealed(SEALED_FIELD_MAX.title),
  content: sealed(SEALED_FIELD_MAX.content),
  excerpt: sealed(SEALED_FIELD_MAX.excerpt),
  font: sealed(SEALED_FIELD_MAX.font),
  images: sealed(SEALED_FIELD_MAX.images),
  // What the two sealed lists name, which the server keeps the images by.
  imageRefs: attachmentRefs(MAX_IMAGES_PER_NOTE),
  linkPreviews: sealed(SEALED_FIELD_MAX.linkPreviews),
  // A thumbnail and an icon for each preview.
  previewRefs: attachmentRefs(MAX_LINK_PREVIEWS_PER_NOTE * 2),
  color: sealedOrEmpty(SEALED_FIELD_MAX.color),
  tags: sealedOrEmpty(SEALED_FIELD_MAX.tags),
  // The note key for a calendar feed, while the note has a reminder.
  reminderKey: sealedOrEmpty(MAX_WRAPPED_KEY_LENGTH).exactOptional(),
  pinned: noteFields.pinned,
  archived: noteFields.archived,
  trashed: noteFields.trashed,
  position: noteFields.position,
  reminder: noteFields.reminder,
  readonly: noteFields.readonly,
  source: noteFields.source,
} as const;

/** `POST /api/v1/attachments/claim`. */
export const attachmentsClaimSchema = z.object({
  noteId: noteIdSchema.exactOptional(),
  refs: attachmentRefs(MAX_ATTACHMENTS_PER_CLAIM),
});

/** `POST /api/v1/notes` from the app. */
export const sealedNoteCreateSchema = z.object({
  id: noteIdSchema,
  key: wrappedKey,
  keyVersion: z.number().int().min(1),
  ...sealedNoteFields,
});

/** `POST /api/v1/notes/import` from the app. A note already there keeps the
 * key it has, which the client sealed this copy under. */
export const sealedNotesImportSchema = z.object({
  notes: z
    .array(
      sealedNoteCreateSchema.extend({
        createdAt: z.iso.datetime({ offset: true }).exactOptional(),
      }),
    )
    .max(MAX_NOTES_PER_IMPORT),
});

/**
 * `PUT /api/v1/notes/:id` from the app. A sealed list travels with the
 * references it names, and the text with its excerpt, or the server's record
 * of either would fall behind what the note says.
 */
export const sealedNoteUpdateSchema = z
  .object({
    ...exactPartial(sealedNoteFields),
    // Which note key the sealed values are under. Checked against the
    // note's, so a change sealed under a key since replaced is refused
    // and not stored where nobody could open it.
    keyVersion: z.number().int().min(1).exactOptional(),
  })
  .refine(
    (body) =>
      (body.images === undefined) === (body.imageRefs === undefined) &&
      (body.linkPreviews === undefined) === (body.previewRefs === undefined) &&
      (body.content === undefined) === (body.excerpt === undefined),
    {
      message:
        "images comes with imageRefs, linkPreviews with previewRefs, content with excerpt",
    },
  );

/**
 * `PUT /api/v1/notes/:id/key`: the note under a new key. Everything everyone on
 * the note shares comes sealed again, with none of it left under the old key.
 */
export const noteRekeySchema = z.object({
  keyVersion: z.number().int().min(2),
  key: wrappedKey,
  previousKeys: sealed(MAX_PREVIOUS_KEYS_LENGTH),
  title: sealed(SEALED_FIELD_MAX.title),
  content: sealed(SEALED_FIELD_MAX.content),
  excerpt: sealed(SEALED_FIELD_MAX.excerpt),
  font: sealed(SEALED_FIELD_MAX.font),
  images: sealed(SEALED_FIELD_MAX.images),
  linkPreviews: sealed(SEALED_FIELD_MAX.linkPreviews),
  links: z
    .array(
      z.object({
        token: z.string().min(1).max(64),
        wrappedKey,
      }),
    )
    .max(100)
    .exactOptional(),
});

/** `POST /api/v1/notes/:id/versions` from the app. */
export const sealedVersionCreateSchema = z.object({
  id: noteIdSchema,
  keyVersion: z.number().int().min(1),
  title: sealed(SEALED_FIELD_MAX.title),
  content: sealed(SEALED_FIELD_MAX.content),
  timestamp: z.string().max(40).exactOptional(),
});

/** `PUT /api/v1/notes/:id/comments/:commentId`: the comment's text sealed under
 * the note key. Its length is the sealing client's to hold. */
export const noteCommentSchema = z.object({
  body: sealed(SEALED_FIELD_MAX.comment),
  keyVersion: z.number().int().min(1),
});

/** `POST /api/v1/notes/:id/comments`, under an id the client chose. */
export const noteCommentCreateSchema = noteCommentSchema.extend({
  id: noteIdSchema,
});

/**
 * A comment from a token that carries a key: its words, which the server
 * seals under the note's key. The same body writes a new one and changes one.
 */
export const commentTextSchema = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
});
