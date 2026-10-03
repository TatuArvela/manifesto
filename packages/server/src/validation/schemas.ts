import {
  API_TOKEN_KINDS,
  API_TOKEN_SCOPES,
  ATTACHMENT_REF_PATTERN,
  MAX_COMMENT_LENGTH,
  MAX_IMAGES_PER_NOTE,
  MAX_LINK_PREVIEW_URL_LENGTH,
  MAX_LINK_PREVIEWS_PER_NOTE,
  MAX_NOTES_PER_IMPORT,
  MAX_PUBLIC_LINK_VIEWS,
  NoteColor,
  NoteFont,
  PUBLIC_LINK_MODES,
  REMINDER_RECURRENCES,
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
 * A patch of an account's preferences: up to 100 keys, each set to any JSON
 * value or to `null` to remove it. The server never reads the values; how
 * large the whole may grow is checked when it is merged.
 */
export const accountPrefsUpdateSchema = z.object({
  prefs: z
    .record(z.string().min(1).max(64), z.json())
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
  /** An authenticator code, or a recovery code, when two-factor is on. */
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

export const shareCreateSchema = z.object({
  userId: z.string().min(1).max(64),
  role: shareRoleSchema,
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
export const publicLinkCreateSchema = z.object({
  mode: z.enum(PUBLIC_LINK_MODES),
  expiresInDays: z.number().int().min(1).max(3650).exactOptional(),
  password: z.string().min(1).max(256).exactOptional(),
  maxViews: z.number().int().min(1).max(MAX_PUBLIC_LINK_VIEWS).exactOptional(),
});

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

export const MAX_LINK_PREVIEW_TITLE_LENGTH = 500;
export const MAX_LINK_PREVIEW_DESCRIPTION_LENGTH = 2000;

const linkPreviewSchema = z.object({
  url: httpUrlSchema,
  title: z.string().max(MAX_LINK_PREVIEW_TITLE_LENGTH),
  description: z
    .string()
    .max(MAX_LINK_PREVIEW_DESCRIPTION_LENGTH)
    .exactOptional(),
  image: previewImageSchema.exactOptional(),
  favicon: previewImageSchema.exactOptional(),
  domain: z.string().max(255),
});

/** The query of `GET /api/link-preview`. */
export const linkPreviewQuerySchema = z.object({ url: httpUrlSchema });

const reminderRecurrenceSchema = z.enum(REMINDER_RECURRENCES);

const reminderSchema = z.object({
  time: z.string(),
  recurrence: reminderRecurrenceSchema,
  day: z.number().int().min(1).max(31).exactOptional(),
  timezone: z.string(),
  lastFiredAt: z.string().exactOptional(),
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
    password: confirmationPassword,
  })
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

/** `POST /api/notes/:id/comments` and `PUT .../comments/:commentId`. Plain
 * text; a comment of nothing but space is no comment. */
export const noteCommentSchema = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH),
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
