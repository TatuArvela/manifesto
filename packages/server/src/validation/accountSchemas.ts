import { RECOVERY_VERIFIER_LENGTH, SEALED_FIELD_MAX } from "@manifesto/shared";
import { z } from "zod";
import {
  confirmationPassword,
  publicKey,
  sealed,
  wrappedKey,
} from "./fields.ts";

// Request bodies of the account: signing in and up, passwords, passkeys and
// two-factor, the account's keys and their recovery, preferences, push
// subscriptions, and the admin's edits of accounts.

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

export const authMeUpdateSchema = z.object({
  email: emailSchema.nullable(),
  password: confirmationPassword,
});

/** Deleting one's own account: only the confirmation. */
export const authMeDeleteSchema = z.object({
  password: confirmationPassword,
});

/** A language tag such as `fi` or `en-GB`; mail falls back to English for one
 * it has no text in. */
export const authLocaleSchema = z.object({
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/),
});

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
