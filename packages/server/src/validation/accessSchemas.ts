import {
  API_TOKEN_KINDS,
  API_TOKEN_SCOPES,
  MAX_TOKEN_KEYS_LENGTH,
  WEBHOOK_EVENTS,
} from "@manifesto/shared";
import { z } from "zod";
import { confirmationPassword, sealed } from "./fields.ts";

// Request bodies of what reaches an account from outside the app: API and
// MCP tokens, an assistant's OAuth sign-in, and webhooks.

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
export const oauthAuthorizeSchema = z
  .object({
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
    // A code the app made, to carry keys: its SHA-256, and the keys wrapped
    // under a key derived from it.
    codeHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .exactOptional(),
    wrappedKeys: sealed(MAX_TOKEN_KEYS_LENGTH).exactOptional(),
  })
  .refine(
    (body) =>
      (body.codeHash === undefined) === (body.wrappedKeys === undefined),
    { message: "codeHash and wrappedKeys come together" },
  );

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
