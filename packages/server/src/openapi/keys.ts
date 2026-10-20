import {
  accountKeysSetupSchema,
  keysConfirmSchema,
  recoveryCompleteSchema,
  recoveryKeyReplaceSchema,
  recoveryOpenSchema,
  recoverySignInCompleteSchema,
  recoverySignInOpenSchema,
  secretKeyReplaceSchema,
} from "#/validation/accountSchemas.ts";
import { seenKeySchema } from "#/validation/sharingSchemas.ts";
import { noContent, type Operation, ok } from "./operation.ts";

const refused = {
  "403": { description: "Not the recovery key", schema: "Error" },
};
const conflict = (description: string) => ({
  "409": { description, schema: "Error" },
});

/**
 * The keys with which the notes of an account are encrypted, wrapped in the
 * browser. Session-only: a token can never get or replace a key. The operations
 * that check a password or the recovery key use `sign-in`, as a sign-in does.
 */
export const KEY_OPERATIONS: Operation[] = [
  {
    method: "get",
    path: "/api/v1/auth/keys",
    tag: "Auth",
    summary:
      "The account's wrapped keys, null before it is set up, and when this session ends at the latest",
    auth: "session",
    limits: [],
    responses: ok("AccountKeysResponse"),
  },
  {
    method: "get",
    path: "/api/v1/auth/keys/seen",
    tag: "Auth",
    summary:
      "The public keys this account has seen of others, each sealed under its own key",
    auth: "session",
    limits: ["user"],
    responses: { "200": { description: "The sealed list, by account id" } },
  },
  {
    method: "put",
    path: "/api/v1/auth/keys/seen/:userId",
    tag: "Auth",
    summary: "Remember someone's public keys, sealed under this account's key",
    auth: "session",
    limits: ["user"],
    body: seenKeySchema,
    responses: {
      ...noContent,
      ...conflict("The account remembers as many as it may"),
    },
  },
  {
    method: "put",
    path: "/api/v1/auth/keys",
    tag: "Auth",
    summary: "Store the account's first keys, made in the browser",
    auth: "session",
    limits: [],
    body: accountKeysSetupSchema,
    responses: { ...noContent, ...conflict("The account has keys already") },
  },
  {
    method: "delete",
    path: "/api/v1/auth/keys",
    tag: "Auth",
    summary:
      "Start the account again with no keys, with the password: for when the secret key and the recovery key are both lost",
    auth: "session",
    limits: ["sign-in"],
    body: keysConfirmSchema,
    responses: { ...noContent, ...conflict("The account has no keys") },
  },
  {
    method: "post",
    path: "/api/v1/auth/keys/confirm",
    tag: "Auth",
    summary: "Check the password before the client shows the secret key",
    auth: "session",
    limits: ["sign-in"],
    body: keysConfirmSchema,
    responses: noContent,
  },
  {
    method: "post",
    path: "/api/v1/auth/keys/secret",
    tag: "Auth",
    summary:
      "Put a new secret key in place, with the password; ends the account's other sessions",
    auth: "session",
    limits: ["sign-in"],
    body: secretKeyReplaceSchema,
    responses: { ...noContent, ...conflict("The account has no keys") },
  },
  {
    method: "post",
    path: "/api/v1/auth/keys/recovery",
    tag: "Auth",
    summary: "Put a new recovery key in place, with the password",
    auth: "session",
    limits: ["sign-in"],
    body: recoveryKeyReplaceSchema,
    responses: { ...noContent, ...conflict("The account has no keys") },
  },
  {
    method: "post",
    path: "/api/v1/auth/keys/recover",
    tag: "Auth",
    summary:
      "Use the recovery key while signed in: answers the account key as it wraps it",
    auth: "session",
    limits: ["sign-in"],
    body: recoveryOpenSchema,
    responses: { ...ok("RecoveryOpenResponse"), ...refused },
  },
  {
    method: "post",
    path: "/api/v1/auth/keys/recover/complete",
    tag: "Auth",
    summary:
      "Finish using the recovery key: a new secret key and recovery key in place of the old; ends the account's other sessions and tokens",
    auth: "session",
    limits: ["sign-in"],
    body: recoveryCompleteSchema,
    responses: {
      ...noContent,
      ...refused,
      ...conflict("The recovery key was used meanwhile"),
    },
  },
  {
    method: "post",
    path: "/api/v1/auth/recovery",
    tag: "Auth",
    summary:
      "Start signing in with the recovery key and the username: answers the account key as it wraps it",
    auth: "none",
    limits: ["sign-in"],
    body: recoverySignInOpenSchema,
    responses: {
      ...ok("RecoveryOpenResponse"),
      "401": { description: "Not the recovery key", schema: "Error" },
    },
    provider: "local",
  },
  {
    method: "post",
    path: "/api/v1/auth/recovery/complete",
    tag: "Auth",
    summary:
      "Finish signing in with the recovery key: a new password, secret key and recovery key; ends every other session and token",
    auth: "none",
    limits: ["sign-in"],
    body: recoverySignInCompleteSchema,
    responses: {
      ...ok("AuthSuccess"),
      "401": { description: "Not the recovery key", schema: "Error" },
      ...conflict("The recovery key was used meanwhile"),
    },
    provider: "local",
  },
];
