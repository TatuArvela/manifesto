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

// The request bodies of notes: as a token sends them, readable, and as the app
// sends them, sealed. Also their versions, attachments and comments.

export const noteColorSchema = z.nativeEnum(NoteColor);
export const noteFontSchema = z.nativeEnum(NoteFont);

/**
 * The link-preview fields, which a renderer will follow, accept only http(s)
 * URLs. This blocks `javascript:`, `data:`, `file:`, and URLs with arbitrary
 * internal schemes. These could otherwise fingerprint or SSRF-probe the network
 * of a recipient when a note is shared through /share/...
 *
 * `Note.images` is not one of these. It contains `attachment:` references.
 */
const httpUrlSchema = z
  .string()
  .url()
  .max(MAX_LINK_PREVIEW_URL_LENGTH)
  .regex(/^https?:\/\//i, "URL must use http(s) scheme");

/**
 * The thumbnail or favicon of a preview: a reference from `POST
 * /api/v1/attachments`, as for `images`. Thus, previews add only their text to
 * a listing. When a person looks at a note, their browser never contacts the
 * linked site (and the CSP of the client would refuse a remote image anyway).
 * The code still accepts an http(s) URL. Thus, you can still update a row
 * written before the server stored previews.
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
  // The card shows `domain` as the target of the link. Thus, it is always the
  // host of the URL, whatever was sent. If not, a writer could make a card that
  // names one site and opens a different site, on a shared note or a public
  // link.
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

// Limited, as all other fields of a note. These go in each listing. Thus, an
// unlimited field can be a megabyte for each note there. A timestamp and an
// IANA zone name are short. The key of a plugin for a note is its own text.
const reminderSchema = z.object({
  time: z.string().max(40),
  recurrence: reminderRecurrenceSchema,
  day: z.number().int().min(1).max(31).exactOptional(),
  timezone: z.string().max(64),
  lastFiredAt: z.string().max(40).exactOptional(),
  urgent: z.literal(true).exactOptional(),
});

const autoNoteSourceSchema = z.object({
  kind: z.literal("auto-note"),
  pluginId: z.string().max(64),
  noteKey: z.string().max(500),
});

// Limits for each field. The request-body limit of 1 MiB is a backstop. But
// without limits for each field, one authenticated user can fill the listByUser
// payload with notes of many MB, and use up the memory of the server. The
// numbers are generous for usual use, but refuse inputs that are clearly
// pathological.
const noteFields = {
  title: z.string().max(MAX_NOTE_TITLE_LENGTH),
  content: z.string().max(MAX_NOTE_CONTENT_LENGTH),
  color: noteColorSchema,
  font: noteFontSchema,
  pinned: z.boolean(),
  archived: z.boolean(),
  trashed: z.boolean(),
  // `trashedAt` is absent on purpose. It controls the hard deletion 30 days
  // later. Thus, a client that could set it could also ask for an immediate
  // deletion of a note, or for no deletion. The routes set it from `trashed`
  // and the server clock, and zod removes all values that a client sends.
  position: z.number(),
  tags: z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_NOTE),
  // References from `POST /api/v1/attachments`. The bytes never go in a note.
  images: z
    .array(z.string().regex(ATTACHMENT_REF_PATTERN, "Upload images first"))
    .max(MAX_IMAGES_PER_NOTE),
  linkPreviews: z.array(linkPreviewSchema).max(MAX_LINK_PREVIEWS_PER_NOTE),
  reminder: reminderSchema.nullable(),
  readonly: z.boolean().exactOptional(),
  source: autoNoteSourceSchema.exactOptional(),
} as const;

export const noteCreateSchema = z.object(noteFields);

/**
 * `POST /api/v1/notes/import`: notes as created, with the id and the creation
 * time from their source.
 */
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

/**
 * `POST /api/v1/notes/:id/versions`: the same limits as for the own text of the
 * note.
 */
export const noteVersionCreateSchema = z.object({
  title: noteFields.title,
  content: noteFields.content,
  timestamp: z.string().max(40).exactOptional(),
});
export const noteUpdateSchema = z.object(exactPartial(noteFields));

// The same requests from the app, which seals notes before they go out of the
// browser. Each value in the words of a person is a ciphertext. The values on
// which the server acts stay as they were.

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
  // What the two sealed lists name, by which the server keeps the images.
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

/**
 * The format of the words of a note (`noteFormat.ts` in shared). The code
 * accepts formats that the server does not know. It stores ciphertext, and an
 * app that is newer than the server can write one.
 */
const noteFormat = z.number().int().min(1).max(1_000_000);

/** The sealed fields that a format covers. */
const WORD_FIELDS = [
  "title",
  "content",
  "excerpt",
  "font",
  "images",
  "linkPreviews",
] as const;

/** `POST /api/v1/notes` from the app. */
export const sealedNoteCreateSchema = z.object({
  id: noteIdSchema,
  key: wrappedKey,
  keyVersion: z.number().int().min(1),
  format: noteFormat,
  ...sealedNoteFields,
});

/**
 * `POST /api/v1/notes/import` from the app. A note that is already there keeps
 * its key, under which the client sealed this copy.
 */
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
 * `PUT /api/v1/notes/:id` from the app. A sealed list goes with the references
 * that it names, and the text with its excerpt. If not, the record of the
 * server of either would be behind what the note says.
 */
export const sealedNoteUpdateSchema = z
  .object({
    ...exactPartial(sealedNoteFields),
    // The note key under which the sealed values are. The code compares it with
    // that of the note. Thus, it refuses a change sealed under a key that was
    // replaced after that, and does not store it where nobody could open it.
    keyVersion: z.number().int().min(1).exactOptional(),
    // The format of the words. See `formatCondition`.
    format: noteFormat.exactOptional(),
  })
  .refine(
    (body) =>
      body.format !== undefined ||
      WORD_FIELDS.every((field) => body[field] === undefined),
    { message: "Words come with the format they are in" },
  )
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
 * `PUT /api/v1/notes/:id/key`: the note under a new key. All that the persons
 * on the note share comes sealed again, with none of it under the old key.
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
export const sealedVersionCreateSchema = z
  .object({
    id: noteIdSchema,
    keyVersion: z.number().int().min(1),
    format: noteFormat,
    title: sealed(SEALED_FIELD_MAX.title),
    content: sealed(SEALED_FIELD_MAX.content),
    images: sealed(SEALED_FIELD_MAX.images).exactOptional(),
    imageRefs: attachmentRefs(MAX_IMAGES_PER_NOTE).exactOptional(),
    timestamp: z.string().max(40).exactOptional(),
  })
  .refine(
    (body) => (body.images === undefined) === (body.imageRefs === undefined),
    { message: "images comes with imageRefs" },
  );

/**
 * `PUT /api/v1/notes/:id/comments/:commentId`: the text of the comment, sealed
 * under the note key. The client that seals it checks its length.
 */
export const noteCommentSchema = z.object({
  body: sealed(SEALED_FIELD_MAX.comment),
  keyVersion: z.number().int().min(1),
});

/** `POST /api/v1/notes/:id/comments`, under an id that the client selected. */
export const noteCommentCreateSchema = noteCommentSchema.extend({
  id: noteIdSchema,
});

/**
 * A comment from a token that carries a key: its words, which the server seals
 * under the key of the note. The same body writes a new comment and changes a
 * comment.
 */
export const commentTextSchema = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
});
