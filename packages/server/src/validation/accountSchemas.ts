import { RECOVERY_VERIFIER_LENGTH, SEALED_FIELD_MAX } from "@manifesto/shared";
import { z } from "zod";
import {
  confirmationPassword,
  publicKey,
  sealed,
  wrappedKey,
} from "./fields.ts";

// The request bodies of the account: sign-in and sign-up, passwords, passkeys
// and two-factor, the keys of the account and their recovery, preferences, push
// subscriptions, and the edits of accounts by an admin.

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
 * An email address, checked only for its shape: something, an `@`, something. A
 * mail server decides if it is deliverable. This only refuses what cannot be an
 * address.
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

/** The deletion of your own account: only the confirmation. */
export const authMeDeleteSchema = z.object({
  password: confirmationPassword,
});

/**
 * A language tag such as `fi` or `en-GB`. Mail uses English for a language for
 * which it has no text.
 */
export const authLocaleSchema = z.object({
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/),
});

/**
 * A patch of the preferences of an account: up to 100 keys, each set to a value
 * sealed under the personal key of the account, or to `null` to remove it. The
 * merge checks the maximum size of the result.
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

/**
 * The answer of the browser to a passkey sign-in, as
 * `PublicKeyCredential.toJSON()` gives it. `@simplewebauthn/server` checks what
 * it proves.
 */
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

/** The answer of the browser when it makes a passkey. */
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
  /** Or the answer of a passkey to the challenge of the first attempt. */
  passkey: passkeyAuthenticationSchema.exactOptional(),
});

/** `POST /api/v1/auth/passkeys`. */
export const passkeyAddSchema = z.object({
  name: z.string().trim().max(100).exactOptional(),
  response: passkeyRegistrationSchema,
});

/** `POST /api/v1/auth/passkey/login`. */
export const passkeyLoginSchema = z.object({
  response: passkeyAuthenticationSchema,
});

/**
 * The two-factor switches ask for the password again. A session that stays open
 * on a shared computer must not be sufficient to turn it off.
 */
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

/** `PUT /api/v1/auth/keys`. */
export const accountKeysSetupSchema = z.object({
  ...recoveryKeyWrap,
  wrappedBySecret: wrappedKey,
  publicKeys: z.object({ exchange: publicKey, signing: publicKey }),
  wrappedPrivateKeys: z.object({ exchange: wrappedKey, signing: wrappedKey }),
});

/** `POST /api/v1/auth/keys/secret`. */
export const secretKeyReplaceSchema = z.object({
  password: confirmationPassword,
  wrappedBySecret: wrappedKey,
});

/** `POST /api/v1/auth/keys/recovery`. */
export const recoveryKeyReplaceSchema = z.object({
  password: confirmationPassword,
  ...recoveryKeyWrap,
});

/** `POST /api/v1/auth/keys/confirm` and `DELETE /api/v1/auth/keys`. */
export const keysConfirmSchema = z.object({
  password: confirmationPassword,
});

/** `POST /api/v1/auth/keys/recover`. */
export const recoveryOpenSchema = z.object({ verifier: recoveryVerifier });

/** `POST /api/v1/auth/keys/recover/complete`. */
export const recoveryCompleteSchema = z.object({
  verifier: recoveryVerifier,
  wrappedBySecret: wrappedKey,
  ...recoveryKeyWrap,
});

/** `POST /api/v1/auth/recovery`. */
export const recoverySignInOpenSchema = recoveryOpenSchema.extend({
  username: usernameSchema,
});

/** `POST /api/v1/auth/recovery/complete`. */
export const recoverySignInCompleteSchema = recoveryCompleteSchema.extend({
  username: usernameSchema,
  newPassword: passwordSchema,
});

export const passwordChangeSchema = z.object({
  // Only compared with the stored hash. Thus, it has only the length limit, not
  // the current rules, which can be newer than an older password.
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
 * `POST /api/v1/push/subscriptions`: what `PushSubscription.toJSON()` gives.
 * The endpoint is the push service of the browser, always over TLS. The send of
 * a message checks where it can point, against the resolved address.
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

/** `DELETE /api/v1/push/subscriptions`. */
export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().min(1).max(2048),
});

/**
 * `POST /api/v1/auth/password-reset`. `locale` selects the language of the
 * mail.
 */
export const passwordResetRequestSchema = z.object({
  email: emailSchema,
  locale: z.string().max(10).exactOptional(),
});

/**
 * `POST /api/v1/auth/sign-in-link`. `locale` selects the language of the mail.
 */
export const signInLinkRequestSchema = z.object({
  email: emailSchema,
  locale: z.string().max(10).exactOptional(),
});

/**
 * `POST /api/v1/auth/sign-in-link/confirm`: the token of the link and, on a
 * second attempt, the second factor for which the first attempt was asked.
 */
export const signInLinkConfirmSchema = z.object({
  token: z.string().min(1).max(200),
  otp: z.string().trim().min(1).max(32).exactOptional(),
  passkey: passkeyAuthenticationSchema.exactOptional(),
});

/** `POST /api/v1/auth/password-reset/confirm`. */
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

/** The id of a request to sign in a new device, or its wait token. */
const deviceSignInToken = z.string().regex(/^[0-9a-f]{64}$/);

/** `POST /api/v1/auth/device-sign-in/inspect`: the id from the QR code. */
export const deviceSignInInspectSchema = z.object({ id: deviceSignInToken });

/**
 * `POST /api/v1/auth/device-sign-in/approve`: the id from the QR code, the
 * secret key wrapped to the new device (absent when the approving device does
 * not hold it), and the password that confirms it.
 */
export const deviceSignInApproveSchema = z.object({
  id: deviceSignInToken,
  key: z.object({ ephemeral: publicKey, wrapped: wrappedKey }).exactOptional(),
  password: confirmationPassword,
});

/** `POST /api/v1/auth/device-sign-in/wait`: the token that the new device kept. */
export const deviceSignInWaitSchema = z.object({
  waitToken: deviceSignInToken,
});
