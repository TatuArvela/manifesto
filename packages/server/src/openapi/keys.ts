import {
  accountKeysSetupSchema,
  keysConfirmSchema,
  recoveryCompleteSchema,
  recoveryKeyReplaceSchema,
  recoveryOpenSchema,
  recoverySignInCompleteSchema,
  recoverySignInOpenSchema,
  secretKeyReplaceSchema,
  seenKeySchema,
} from "../validation/schemas.js";
import { noContent, type Operation, ok } from "./operation.js";

const refused = {
  "403": { description: "Not the recovery key", schema: "Error" },
};
const conflict = (description: string) => ({
  "409": { description, schema: "Error" },
});

/**
 * The keys an account's notes are encrypted with, wrapped in the browser.
 * Session-only: a key is never a token's to fetch or replace. What checks a
 * password or the recovery key draws on `sign-in`, like a sign-in.
 */
export const KEY_OPERATIONS: Operation[] = [
  {
    method: "get",
    path: "/api/auth/keys",
    tag: "Auth",
    summary:
      "The account's wrapped keys, null before it is set up, and when this session ends at the latest",
    auth: "session",
    limits: [],
    responses: ok("AccountKeysResponse"),
  },
  {
    method: "get",
    path: "/api/auth/keys/seen",
    tag: "Auth",
    summary:
      "The public keys this account has seen of others, each sealed under its own key",
    auth: "session",
    limits: ["user"],
    responses: { "200": { description: "The sealed list, by account id" } },
  },
  {
    method: "put",
    path: "/api/auth/keys/seen/:userId",
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
    path: "/api/auth/keys",
    tag: "Auth",
    summary: "Store the account's first keys, made in the browser",
    auth: "session",
    limits: [],
    body: accountKeysSetupSchema,
    responses: { ...noContent, ...conflict("The account has keys already") },
  },
  {
    method: "delete",
    path: "/api/auth/keys",
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
    path: "/api/auth/keys/confirm",
    tag: "Auth",
    summary: "Check the password before the client shows the secret key",
    auth: "session",
    limits: ["sign-in"],
    body: keysConfirmSchema,
    responses: noContent,
  },
  {
    method: "post",
    path: "/api/auth/keys/secret",
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
    path: "/api/auth/keys/recovery",
    tag: "Auth",
    summary: "Put a new recovery key in place, with the password",
    auth: "session",
    limits: ["sign-in"],
    body: recoveryKeyReplaceSchema,
    responses: { ...noContent, ...conflict("The account has no keys") },
  },
  {
    method: "post",
    path: "/api/auth/keys/recover",
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
    path: "/api/auth/keys/recover/complete",
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
    path: "/api/auth/recovery",
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
    path: "/api/auth/recovery/complete",
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
