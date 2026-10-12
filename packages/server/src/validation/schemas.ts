import {
  API_TOKEN_KINDS,
  API_TOKEN_SCOPES,
  ATTACHMENT_REF_PATTERN,
  isCiphertext,
  MAX_ATTACHMENTS_PER_CLAIM,
  MAX_IMAGES_PER_NOTE,
  MAX_LINK_PREVIEW_DESCRIPTION_LENGTH,
  MAX_LINK_PREVIEW_TITLE_LENGTH,
  MAX_LINK_PREVIEW_URL_LENGTH,
  MAX_LINK_PREVIEWS_PER_NOTE,
  MAX_NOTE_CONTENT_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  MAX_NOTES_PER_IMPORT,
  MAX_PREVIOUS_KEYS_LENGTH,
  MAX_PUBLIC_LINK_VIEWS,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_NOTE,
  MAX_TOKEN_KEYS_LENGTH,
  MAX_WRAPPED_KEY_LENGTH,
  NoteColor,
  NoteFont,
  OFFERED_KEY_MAX,
  PUBLIC_KEY_LENGTH,
  PUBLIC_LINK_MODES,
  RECOVERY_VERIFIER_LENGTH,
  REMINDER_RECURRENCES,
  SEALED_FIELD_MAX,
  SHARE_ROLES,
  WEBHOOK_EVENTS,
} from "@manifesto/shared";
import { z } from "zod";

/**
 * Every field of `shape`, made optional the way a JSON body is: a key that is
 * absent, never one that is present and `undefined`. `.partial()` gives the
 * second, which the wire types in `@manifesto/shared` do not allow.
 */
function exactPartial<T extends z.ZodRawShape>(
  shape: T,
): { [K in keyof T]: z.ZodExactOptional<T[K]> } {
  return Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [key, z.exactOptional(field)]),
  ) as { [K in keyof T]: z.ZodExactOptional<T[K]> };
}

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
 * A mail server is the judge of whether it is deliverable; this only refuses
 * what cannot be an address at all.
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
  email: emailSchema.exactOptional(),
});

/** The password that confirms an action, where the account has one (see
 * `auth/confirmation.ts`). Only compared with the stored hash. */
const confirmationPassword = z.string().max(256).exactOptional();

export const authMeUpdateSchema = z.object({
  email: emailSchema.nullable(),
  password: confirmationPassword,
});

/** A language tag such as `fi` or `en-GB`; mail falls back to English for one
 * it has no text in. */
export const authLocaleSchema = z.object({
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/),
});

/**
 * A value sealed in the browser: a ciphertext by its shape, which is all the
 * server can say about one. Anything else in its place is refused, so a
 * faulty client cannot store readable text where a ciphertext belongs.
 */
const sealed = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => isCiphertext(value, max), {
      message: "Must be a ciphertext",
    });

/** An id chosen by the client that seals what it names: a note's, a
 * version's, a comment's. */
const noteIdSchema = z.string().regex(/^[0-9A-Za-z_-]{1,64}$/);

/** A sealed value, or nothing where one was never set. */
const sealedOrEmpty = (max: number) => z.union([z.literal(""), sealed(max)]);

/**
 * A patch of an account's preferences: up to 100 keys, each set to a value
 * sealed under the account's personal key, or to `null` to remove it. How
 * large the whole may grow is checked when it is merged.
 */
export const accountPrefsUpdateSchema = z.object({
  prefs: z
    .record(z.string().min(1).max(64), sealed(SEALED_FIELD_MAX.pref).nullable())
    .refine((prefs) => Object.keys(prefs).length <= 100, {
      message: "At most 100 preferences",
    }),
});

/** A WebAuthn binary value in its JSON form. */
const base64url = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[A-Za-z0-9_-]*$/);

/** The browser's answer to a passkey sign-in, as `PublicKeyCredential.toJSON()`
 * gives it. What it proves is `@simplewebauthn/server`'s to check. */
export const passkeyAuthenticationSchema = z.object({
  id: base64url(1024),
  rawId: base64url(1024),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url(8192),
    authenticatorData: base64url(8192),
    signature: base64url(2048),
    userHandle: base64url(512).exactOptional(),
  }),
  authenticatorAttachment: z.string().max(50).exactOptional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
});

/** The browser's answer to making a passkey. */
export const passkeyRegistrationSchema = z.object({
  id: base64url(1024),
  rawId: base64url(1024),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url(8192),
    attestationObject: base64url(65536),
    transports: z.array(z.string().max(50)).max(10).exactOptional(),
  }),
  authenticatorAttachment: z.string().max(50).exactOptional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
});

export const loginSchema = authCredentialsSchema.extend({
  newPassword: passwordSchema.exactOptional(),
  /** An authenticator code, when two-factor is on. */
  otp: z.string().trim().min(1).max(32).exactOptional(),
  /** Or a passkey's answer to the challenge the first attempt was given. */
  passkey: passkeyAuthenticationSchema.exactOptional(),
});

/** `POST /api/auth/passkeys`. */
export const passkeyAddSchema = z.object({
  name: z.string().trim().max(100).exactOptional(),
  response: passkeyRegistrationSchema,
});

/** `POST /api/auth/passkey/login`. */
export const passkeyLoginSchema = z.object({
  response: passkeyAuthenticationSchema,
});

/** Re-entering the password guards the two-factor switches: a session left
 * open on a shared computer must not be enough to turn it off. */
export const twoFactorPasswordSchema = z.object({
  password: z.string().max(256),
});

export const twoFactorEnableSchema = z.object({
  code: z.string().trim().min(6).max(10),
});

/**
 * A wrapped key: a ciphertext by its shape, which is all the server can say
 * about one. Anything else in its place is refused, so a faulty client cannot
 * store a key where a wrapped key belongs.
 */
const wrappedKey = sealed(MAX_WRAPPED_KEY_LENGTH);

/** An uncompressed P-256 point as base64url: 65 bytes, the first of them 4. */
const publicKey = z
  .string()
  .length(PUBLIC_KEY_LENGTH)
  .regex(/^B[A-Za-z0-9_-]+$/, "Must be a P-256 public key");

/** What a recovery key proves itself with: 32 bytes as base64url. */
const recoveryVerifier = z
  .string()
  .length(RECOVERY_VERIFIER_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/, "Must be base64url");

const recoveryKeyWrap = {
  wrappedByRecovery: wrappedKey,
  recoveryVerifier,
};

/** `PUT /api/auth/keys`. */
export const accountKeysSetupSchema = z.object({
  ...recoveryKeyWrap,
  wrappedBySecret: wrappedKey,
  publicKeys: z.object({ exchange: publicKey, signing: publicKey }),
  wrappedPrivateKeys: z.object({ exchange: wrappedKey, signing: wrappedKey }),
});

/** `POST /api/auth/keys/secret`. */
export const secretKeyReplaceSchema = z.object({
  password: confirmationPassword,
  wrappedBySecret: wrappedKey,
});

/** `POST /api/auth/keys/recovery`. */
export const recoveryKeyReplaceSchema = z.object({
  password: confirmationPassword,
  ...recoveryKeyWrap,
});

/** `POST /api/auth/keys/confirm` and `DELETE /api/auth/keys`. */
export const keysConfirmSchema = z.object({
  password: confirmationPassword,
});

/** `POST /api/auth/keys/recover`. */
export const recoveryOpenSchema = z.object({ verifier: recoveryVerifier });

/** `POST /api/auth/keys/recover/complete`. */
export const recoveryCompleteSchema = z.object({
  verifier: recoveryVerifier,
  wrappedBySecret: wrappedKey,
  ...recoveryKeyWrap,
});

/** `POST /api/auth/recovery`. */
export const recoverySignInOpenSchema = recoveryOpenSchema.extend({
  username: usernameSchema,
});

/** `POST /api/auth/recovery/complete`. */
export const recoverySignInCompleteSchema = recoveryCompleteSchema.extend({
  username: usernameSchema,
  newPassword: passwordSchema,
});

export const passwordChangeSchema = z.object({
  // Only compared with the stored hash, so it is held to the length cap and
  // not to today's rules, which an older password may predate.
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});

export const adminCreateUserSchema = z.object({
  username: usernameSchema,
  email: emailSchema.exactOptional(),
});

export const adminUpdateUserSchema = z
  .object({
    isAdmin: z.boolean().exactOptional(),
    email: emailSchema.nullable().exactOptional(),
  })
  .refine((body) => body.isAdmin !== undefined || body.email !== undefined, {
    message: "Nothing to change",
  });

const shareRoleSchema = z.enum(SHARE_ROLES);

/**
 * A note key wrapped to someone's public key and signed: shapes only, since
 * the server can open none of it. The recipient's client checks the
 * signature against the key it remembers for the signer.
 */
export const offeredKeySchema = z.object({
  keyVersion: z.number().int().min(1),
  ephemeral: publicKey,
  wrapped: sealed(OFFERED_KEY_MAX.wrapped),
  signer: z.string().min(1).max(64),
  signature: z
    .string()
    .min(1)
    .max(OFFERED_KEY_MAX.signature)
    .regex(/^[A-Za-z0-9_-]+$/, "Must be base64url"),
});

export const shareCreateSchema = z.object({
  userId: z.string().min(1).max(64),
  role: shareRoleSchema,
  key: offeredKeySchema.exactOptional(),
});

/** `PUT /api/auth/keys/seen/:userId`: someone's public keys as this account
 * remembers them, sealed under its own key. */
export const seenKeySchema = z.object({ sealed: sealed(1024) });

/** `POST /api/invitations/:noteId/accept` and `PUT /api/notes/:id/held-key`. */
export const heldKeySchema = z.object({
  key: wrappedKey,
  keyVersion: z.number().int().min(1),
});

export const shareUpdateSchema = z.object({ role: shareRoleSchema });

const teamName = z.string().trim().min(1).max(100);
const teamMemberIds = z.array(z.string().min(1).max(64)).max(1000);

/** `POST /api/admin/teams`. */
export const adminTeamCreateSchema = z.object({
  name: teamName,
  memberIds: teamMemberIds.exactOptional(),
});

/** `PUT /api/admin/teams/:id`. */
export const adminTeamUpdateSchema = z
  .object({
    name: teamName.exactOptional(),
    memberIds: teamMemberIds.exactOptional(),
  })
  .refine((body) => body.name !== undefined || body.memberIds !== undefined, {
    message: "Nothing to change",
  });

/** `POST /api/notes/:id/team-shares`. */
export const teamShareCreateSchema = z.object({
  teamId: z.string().min(1).max(64),
  role: shareRoleSchema,
});

/** `POST /api/notes/:id/links`. */
export const publicLinkCreateSchema = z
  .object({
    mode: z.enum(PUBLIC_LINK_MODES),
    expiresInDays: z.number().int().min(1).max(3650).exactOptional(),
    password: z.string().min(1).max(256).exactOptional(),
    maxViews: z
      .number()
      .int()
      .min(1)
      .max(MAX_PUBLIC_LINK_VIEWS)
      .exactOptional(),
    // The link key, sealed for the owner; the server never holds the key.
    sealedLinkKey: sealed(MAX_WRAPPED_KEY_LENGTH),
    // A live link: the note key, wrapped by the link key.
    wrappedKey: wrappedKey.exactOptional(),
    // A snapshot link: the note as it is, sealed for the link.
    snapshot: z
      .object({
        title: sealed(SEALED_FIELD_MAX.title),
        content: sealed(SEALED_FIELD_MAX.content),
        font: sealed(SEALED_FIELD_MAX.font),
        images: sealed(SEALED_FIELD_MAX.images),
        linkPreviews: sealed(SEALED_FIELD_MAX.linkPreviews),
        refs: z
          .array(z.string().regex(ATTACHMENT_REF_PATTERN))
          .max(MAX_IMAGES_PER_NOTE + MAX_LINK_PREVIEWS_PER_NOTE * 2),
      })
      .exactOptional(),
  })
  .refine(
    (body) =>
      body.mode === "live"
        ? body.wrappedKey !== undefined && body.snapshot === undefined
        : body.snapshot !== undefined && body.wrappedKey === undefined,
    { message: "A live link takes wrappedKey, a snapshot link takes snapshot" },
  );

/** `POST /api/public/:token/unlock`. */
export const publicLinkUnlockSchema = z.object({
  password: z.string().min(1).max(256),
});

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
 * A preview's thumbnail or favicon: a reference from `POST /api/attachments`,
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

/** The query of `GET /api/link-preview`. */
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
  // References from `POST /api/attachments`; the bytes never ride in a note.
  images: z
    .array(z.string().regex(ATTACHMENT_REF_PATTERN, "Upload images first"))
    .max(MAX_IMAGES_PER_NOTE),
  linkPreviews: z.array(linkPreviewSchema).max(MAX_LINK_PREVIEWS_PER_NOTE),
  reminder: reminderSchema.nullable(),
  readonly: z.boolean().exactOptional(),
  source: autoNoteSourceSchema.exactOptional(),
} as const;

export const noteCreateSchema = z.object(noteFields);

/** `POST /api/notes/import`: notes as created, with the id and creation time
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

/** `POST /api/notes/:id/versions`: the same bounds as the note's own text. */
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

/** `POST /api/attachments/claim`. */
export const attachmentsClaimSchema = z.object({
  noteId: noteIdSchema.exactOptional(),
  refs: attachmentRefs(MAX_ATTACHMENTS_PER_CLAIM),
});

/** `POST /api/notes` from the app. */
export const sealedNoteCreateSchema = z.object({
  id: noteIdSchema,
  key: wrappedKey,
  keyVersion: z.number().int().min(1),
  ...sealedNoteFields,
});

/** `POST /api/notes/import` from the app. A note already there keeps the
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
 * `PUT /api/notes/:id` from the app. A sealed list travels with the
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
 * `PUT /api/notes/:id/key`: the note under a new key. Everything everyone on
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

/** `POST /api/notes/:id/versions` from the app. */
export const sealedVersionCreateSchema = z.object({
  id: noteIdSchema,
  keyVersion: z.number().int().min(1),
  title: sealed(SEALED_FIELD_MAX.title),
  content: sealed(SEALED_FIELD_MAX.content),
  timestamp: z.string().max(40).exactOptional(),
});

/** `POST /api/tokens`. An MCP token's tools reach notes and nothing else,
 * so it takes only the note scopes. */
export const apiTokenCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    expiresInDays: z.number().int().min(1).max(3650).exactOptional(),
    kind: z.enum(API_TOKEN_KINDS).exactOptional(),
    scopes: z
      .array(z.enum(API_TOKEN_SCOPES))
      .min(1)
      .max(API_TOKEN_SCOPES.length)
      .exactOptional(),
    // A token the app made, to carry keys: the secret's SHA-256, its first
    // characters for a list to show, and the keys wrapped under it.
    tokenHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .exactOptional(),
    prefix: z
      .string()
      .regex(/^mf[pmc]_[A-Za-z0-9_-]{6}$/)
      .exactOptional(),
    wrappedKeys: sealed(MAX_TOKEN_KEYS_LENGTH).exactOptional(),
    password: confirmationPassword,
  })
  .refine(
    (body) =>
      (body.tokenHash === undefined) === (body.prefix === undefined) &&
      (body.tokenHash === undefined) === (body.wrappedKeys === undefined),
    { message: "tokenHash, prefix and wrappedKeys come together" },
  )
  .refine(
    (body) =>
      body.kind !== "mcp" ||
      (body.scopes ?? []).every((scope) => scope.startsWith("notes:")),
    {
      message: "An MCP token takes only notes:read and notes:write",
      path: ["scopes"],
    },
  );

/**
 * `POST /api/oauth/register`, in the names RFC 7591 gives them. Unknown fields
 * are dropped; which redirect addresses are allowed is `redirectUriProblem`'s
 * to say, so the answer can use the error the RFC names.
 */
export const oauthRegisterSchema = z.object({
  redirect_uris: z.array(z.string()).min(1).max(10),
  client_name: z.string().max(1000).exactOptional(),
  token_endpoint_auth_method: z.string().max(100).exactOptional(),
  grant_types: z.array(z.string().max(100)).max(10).exactOptional(),
  response_types: z.array(z.string().max(100)).max(10).exactOptional(),
});

/** `POST /api/oauth/authorize`: the consent page's answer. */
export const oauthAuthorizeSchema = z.object({
  clientId: z.string().min(1).max(2000),
  redirectUri: z.string().min(1).max(2000),
  // A base64url SHA-256, which is 43 characters.
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  state: z.string().max(2000).exactOptional(),
  scopes: z
    .array(z.enum(["notes:read", "notes:write"]))
    .min(1)
    .max(2),
  expiresInDays: z.number().int().min(1).max(3650).exactOptional(),
  password: confirmationPassword,
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
    .exactOptional(),
  password: confirmationPassword,
});

/** `PUT /api/webhooks/:id`. */
export const webhookUpdateSchema = z.object({ active: z.boolean() });

/** `PUT /api/notes/:id/comments/:commentId`: the comment's text sealed under
 * the note key. Its length is the sealing client's to hold. */
export const noteCommentSchema = z.object({
  body: sealed(SEALED_FIELD_MAX.comment),
  keyVersion: z.number().int().min(1),
});

/** `POST /api/notes/:id/comments`, under an id the client chose. */
export const noteCommentCreateSchema = noteCommentSchema.extend({
  id: noteIdSchema,
});

/**
 * `POST /api/push/subscriptions`: what `PushSubscription.toJSON()` gives. The
 * endpoint is the browser's push service, always over TLS; where it may point
 * is checked when a message is sent, against the resolved address.
 */
export const pushSubscribeSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .regex(/^https:\/\//i, "endpoint must use https"),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

/** `DELETE /api/push/subscriptions`. */
export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().min(1).max(2048),
});

/** `POST /api/auth/password-reset`. `locale` picks the mail's language. */
export const passwordResetRequestSchema = z.object({
  email: emailSchema,
  locale: z.string().max(10).exactOptional(),
});

/** `POST /api/auth/sign-in-link`. `locale` picks the mail's language. */
export const signInLinkRequestSchema = z.object({
  email: emailSchema,
  locale: z.string().max(10).exactOptional(),
});

/** `POST /api/auth/sign-in-link/confirm`: the link's token, and on a second
 * attempt the second factor the first one was asked for. */
export const signInLinkConfirmSchema = z.object({
  token: z.string().min(1).max(200),
  otp: z.string().trim().min(1).max(32).exactOptional(),
  passkey: passkeyAuthenticationSchema.exactOptional(),
});

/** `POST /api/auth/password-reset/confirm`. */
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
