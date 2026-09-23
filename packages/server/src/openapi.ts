import { z } from "zod";
import {
  adminCreateUserSchema,
  adminUpdateUserSchema,
  apiTokenCreateSchema,
  authMeUpdateSchema,
  loginSchema,
  noteCreateSchema,
  noteUpdateSchema,
  noteVersionCreateSchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerSchema,
  shareCreateSchema,
  shareUpdateSchema,
  twoFactorEnableSchema,
  twoFactorPasswordSchema,
  webhookCreateSchema,
  webhookUpdateSchema,
} from "./validation/schemas.js";

/**
 * The API as an OpenAPI 3.1 document, served at `GET /api/openapi.json`.
 *
 * Request bodies are not described here: they are the zod schemas the routes
 * validate with, converted, so a change to what a route accepts changes the
 * document with it. What this file adds is the list of operations, and
 * `openapi.test.ts` holds that list to the routes the app actually registers,
 * in both directions, so an endpoint cannot be added or removed without the
 * document following. Response bodies are named after the types in
 * `@manifesto/shared/api.ts`; the notes are described in full, the rest by
 * name and shape.
 */

type Auth = "none" | "any" | "session";

export interface Operation {
  method: "get" | "post" | "put" | "delete";
  /** Hono's form, `:id`; written as `{id}` in the document. */
  path: string;
  tag: string;
  summary: string;
  /** `session`: a sign-in session only, refused to an API token. */
  auth: Auth;
  body?: z.ZodType;
  query?: Record<string, string>;
  /** Status to description; `schema` names a component. */
  responses: Record<string, { description: string; schema?: string }>;
  /** Registered only under this auth provider. */
  provider?: "local" | "oidc";
}

const ok = (schema?: string) => ({
  "200": { description: "OK", ...(schema && { schema }) },
});
const noContent = { "204": { description: "Done" } };
const notFound = { "404": { description: "Not found", schema: "Error" } };

export const OPERATIONS: Operation[] = [
  {
    method: "get",
    path: "/api/health",
    tag: "Server",
    summary: "Liveness, and the running version",
    auth: "none",
    responses: ok("Health"),
  },
  {
    method: "get",
    path: "/api/openapi.json",
    tag: "Server",
    summary: "This document",
    auth: "none",
    responses: ok(),
  },
  {
    method: "get",
    path: "/api/auth/methods",
    tag: "Auth",
    summary: "How to sign in here, and what this server offers",
    auth: "none",
    responses: ok("AuthMethodsResponse"),
  },
  {
    method: "get",
    path: "/api/auth/me",
    tag: "Auth",
    summary: "The signed-in user",
    auth: "any",
    responses: ok("AuthMeResponse"),
  },
  {
    method: "put",
    path: "/api/auth/me",
    tag: "Auth",
    summary: "Set or clear the signed-in user's email address",
    auth: "session",
    body: authMeUpdateSchema,
    responses: ok("AuthMeResponse"),
  },
  {
    method: "post",
    path: "/api/auth/register",
    tag: "Auth",
    summary: "Create an account (local sign-in, when registration is open)",
    auth: "none",
    body: registerSchema,
    responses: { "201": { description: "Signed in", schema: "AuthSuccess" } },
    provider: "local",
  },
  {
    method: "post",
    path: "/api/auth/login",
    tag: "Auth",
    summary: "Sign in with a username and password",
    auth: "none",
    body: loginSchema,
    responses: ok("AuthSuccess"),
    provider: "local",
  },
  {
    method: "get",
    path: "/api/auth/login",
    tag: "Auth",
    summary: "Start single sign-on (redirects to the identity provider)",
    auth: "none",
    responses: { "302": { description: "To the identity provider" } },
    provider: "oidc",
  },
  {
    method: "get",
    path: "/api/auth/callback",
    tag: "Auth",
    summary: "Where the identity provider returns to",
    auth: "none",
    responses: { "302": { description: "To the client, with a token" } },
    provider: "oidc",
  },
  {
    method: "post",
    path: "/api/auth/logout",
    tag: "Auth",
    summary: "End this session",
    auth: "any",
    responses: noContent,
  },
  {
    method: "post",
    path: "/api/auth/password",
    tag: "Auth",
    summary: "Change the signed-in user's password; other sessions end",
    auth: "session",
    body: passwordChangeSchema,
    responses: noContent,
    provider: "local",
  },
  {
    method: "post",
    path: "/api/auth/password-reset",
    tag: "Auth",
    summary: "Mail a reset link to a local account's address; always 204",
    auth: "none",
    body: passwordResetRequestSchema,
    responses: noContent,
    provider: "local",
  },
  {
    method: "post",
    path: "/api/auth/password-reset/confirm",
    tag: "Auth",
    summary: "Set a new password with a link's token; ends every session",
    auth: "none",
    body: passwordResetConfirmSchema,
    responses: {
      ...noContent,
      "410": { description: "Expired or used", schema: "Error" },
    },
    provider: "local",
  },
  {
    method: "get",
    path: "/api/auth/two-factor",
    tag: "Auth",
    summary: "Whether two-factor sign-in is on, and recovery codes left",
    auth: "session",
    responses: ok("TwoFactorStatusResponse"),
    provider: "local",
  },
  {
    method: "post",
    path: "/api/auth/two-factor/setup",
    tag: "Auth",
    summary: "Start turning two-factor on: a new authenticator secret",
    auth: "session",
    body: twoFactorPasswordSchema,
    responses: ok("TwoFactorSetupResponse"),
    provider: "local",
  },
  {
    method: "post",
    path: "/api/auth/two-factor/enable",
    tag: "Auth",
    summary: "Confirm with a code; answers the recovery codes, once",
    auth: "session",
    body: twoFactorEnableSchema,
    responses: ok("TwoFactorRecoveryCodesResponse"),
    provider: "local",
  },
  {
    method: "post",
    path: "/api/auth/two-factor/disable",
    tag: "Auth",
    summary: "Turn two-factor off",
    auth: "session",
    body: twoFactorPasswordSchema,
    responses: noContent,
    provider: "local",
  },
  {
    method: "post",
    path: "/api/auth/two-factor/recovery-codes",
    tag: "Auth",
    summary: "Replace the recovery codes",
    auth: "session",
    body: twoFactorPasswordSchema,
    responses: ok("TwoFactorRecoveryCodesResponse"),
    provider: "local",
  },
  {
    method: "get",
    path: "/api/notes",
    tag: "Notes",
    summary: "One page of the user's notes, newest first, without images",
    auth: "any",
    query: { limit: "Page size", cursor: "From the previous page" },
    responses: ok("NotesResponse"),
  },
  {
    method: "post",
    path: "/api/notes",
    tag: "Notes",
    summary: "Create a note",
    auth: "any",
    body: noteCreateSchema,
    responses: { "201": { description: "Created", schema: "NoteResponse" } },
  },
  {
    method: "get",
    path: "/api/notes/:id",
    tag: "Notes",
    summary: "One note, with its images",
    auth: "any",
    responses: { ...ok("NoteResponse"), ...notFound },
  },
  {
    method: "put",
    path: "/api/notes/:id",
    tag: "Notes",
    summary: "Change a note; send If-Match for a compare-and-set",
    auth: "any",
    body: noteUpdateSchema,
    responses: {
      ...ok("NoteResponse"),
      "403": { description: "Your role does not allow it", schema: "Error" },
      ...notFound,
      "412": { description: "Changed since; carries the current note" },
    },
  },
  {
    method: "delete",
    path: "/api/notes/:id",
    tag: "Notes",
    summary: "Delete a note (a recipient leaves it instead)",
    auth: "any",
    responses: { ...noContent, ...notFound },
  },
  {
    method: "get",
    path: "/api/notes/:id/versions",
    tag: "Notes",
    summary: "The note's version history, newest first",
    auth: "any",
    responses: ok("NoteVersionsResponse"),
  },
  {
    method: "post",
    path: "/api/notes/:id/versions",
    tag: "Notes",
    summary: "Add a version (owner and editors)",
    auth: "any",
    body: noteVersionCreateSchema,
    responses: { "201": { description: "Added" } },
  },
  {
    method: "post",
    path: "/api/notes/:id/shares",
    tag: "Sharing",
    summary: "Invite an account to the note (owner)",
    auth: "any",
    body: shareCreateSchema,
    responses: { "201": { description: "Invited", schema: "NoteResponse" } },
  },
  {
    method: "put",
    path: "/api/notes/:id/shares/:userId",
    tag: "Sharing",
    summary: "Change someone's role (owner)",
    auth: "any",
    body: shareUpdateSchema,
    responses: ok("NoteResponse"),
  },
  {
    method: "delete",
    path: "/api/notes/:id/shares/:userId",
    tag: "Sharing",
    summary: "Remove someone, or leave the note yourself",
    auth: "any",
    responses: noContent,
  },
  {
    method: "get",
    path: "/api/invitations",
    tag: "Sharing",
    summary: "Notes offered to the user",
    auth: "any",
    responses: ok("InvitationsResponse"),
  },
  {
    method: "post",
    path: "/api/invitations/:noteId/accept",
    tag: "Sharing",
    summary: "Accept an invitation",
    auth: "any",
    responses: ok("NoteResponse"),
  },
  {
    method: "post",
    path: "/api/invitations/:noteId/decline",
    tag: "Sharing",
    summary: "Decline an invitation",
    auth: "any",
    responses: noContent,
  },
  {
    method: "get",
    path: "/api/users",
    tag: "Sharing",
    summary: "Find accounts to share with",
    auth: "any",
    query: { q: "Name, username or email address" },
    responses: ok("UserLookupResponse"),
  },
  {
    method: "get",
    path: "/api/search",
    tag: "Notes",
    summary: "Notes holding every word of q (by word prefix), newest first",
    auth: "any",
    query: { q: "Search words", limit: "Page size", cursor: "Next page" },
    responses: ok("NotesResponse"),
  },
  {
    method: "get",
    path: "/api/attachments/:id",
    tag: "Notes",
    summary: "The bytes of an image a note refers to as attachment:<id>",
    auth: "any",
    responses: {
      "200": { description: "The image, with its media type" },
      ...notFound,
    },
  },
  {
    method: "get",
    path: "/api/link-preview",
    tag: "Notes",
    summary: "What the server could read from a linked page",
    auth: "any",
    query: { url: "An http(s) URL" },
    responses: ok("LinkPreviewResponse"),
  },
  {
    method: "get",
    path: "/api/export",
    tag: "Account",
    summary: "Every note the account owns, as a zip of JSON and Markdown",
    auth: "any",
    responses: { "200": { description: "application/zip" } },
  },
  {
    method: "get",
    path: "/api/tokens",
    tag: "Account",
    summary: "The user's personal API tokens, without secrets",
    auth: "session",
    responses: ok("ApiTokensResponse"),
  },
  {
    method: "post",
    path: "/api/tokens",
    tag: "Account",
    summary: "Mint an API token; the secret is in this response only",
    auth: "session",
    body: apiTokenCreateSchema,
    responses: {
      "201": { description: "Created", schema: "ApiTokenCreatedResponse" },
    },
  },
  {
    method: "delete",
    path: "/api/tokens/:id",
    tag: "Account",
    summary: "Revoke an API token",
    auth: "session",
    responses: { ...noContent, ...notFound },
  },
  {
    method: "get",
    path: "/api/webhooks",
    tag: "Account",
    summary: "The user's webhooks, without secrets",
    auth: "session",
    responses: ok("WebhooksResponse"),
  },
  {
    method: "post",
    path: "/api/webhooks",
    tag: "Account",
    summary: "Add a webhook; the signing secret is in this response only",
    auth: "session",
    body: webhookCreateSchema,
    responses: {
      "201": { description: "Created", schema: "WebhookCreatedResponse" },
    },
  },
  {
    method: "put",
    path: "/api/webhooks/:id",
    tag: "Account",
    summary: "Turn a webhook on or off",
    auth: "session",
    body: webhookUpdateSchema,
    responses: ok(),
  },
  {
    method: "delete",
    path: "/api/webhooks/:id",
    tag: "Account",
    summary: "Remove a webhook",
    auth: "session",
    responses: noContent,
  },
  {
    method: "post",
    path: "/api/webhooks/:id/test",
    tag: "Account",
    summary: "Send a ping and report what came back",
    auth: "session",
    responses: ok(),
  },
  {
    method: "get",
    path: "/api/admin/users",
    tag: "Admin",
    summary: "Every account",
    auth: "session",
    responses: ok("AdminUsersResponse"),
  },
  {
    method: "get",
    path: "/api/admin/users/:id/export",
    tag: "Admin",
    summary: "Every note an account owns, as a zip",
    auth: "session",
    responses: { "200": { description: "application/zip" }, ...notFound },
  },
  {
    method: "get",
    path: "/api/admin/update",
    tag: "Admin",
    summary: "The running version, and the newest release if the check is on",
    auth: "session",
    responses: ok(),
  },
  {
    method: "get",
    path: "/api/admin/overview",
    tag: "Admin",
    summary: "What the server holds, and how its background jobs last ran",
    auth: "session",
    responses: ok("AdminOverviewResponse"),
  },
  {
    method: "get",
    path: "/api/admin/audit",
    tag: "Admin",
    summary: "The audit log, newest first",
    auth: "session",
    query: {
      limit: "Entries per page (up to 500)",
      before: "An entry id; older entries only",
      userId: "Entries where this account acted or was acted on",
      action: "One kind of entry",
    },
    responses: ok("AuditLogResponse"),
  },
  {
    method: "post",
    path: "/api/admin/users",
    tag: "Admin",
    summary: "Create an account with a temporary password",
    auth: "session",
    body: adminCreateUserSchema,
    responses: {
      "201": {
        description: "Created",
        schema: "AdminTemporaryPasswordResponse",
      },
    },
  },
  {
    method: "put",
    path: "/api/admin/users/:id",
    tag: "Admin",
    summary: "Grant or take admin, or set an email address",
    auth: "session",
    body: adminUpdateUserSchema,
    responses: ok("AdminUserResponse"),
  },
  {
    method: "post",
    path: "/api/admin/users/:id/password",
    tag: "Admin",
    summary: "Issue a temporary password; the user's sessions end",
    auth: "session",
    responses: ok("AdminTemporaryPasswordResponse"),
  },
  {
    method: "delete",
    path: "/api/admin/users/:id",
    tag: "Admin",
    summary: "Delete an account and its notes",
    auth: "session",
    responses: noContent,
  },
];

const noteResponseSchema = noteCreateSchema.extend({
  id: z.string(),
  trashedAt: z.string().nullable(),
  imageCount: z.number().int().optional(),
  sharing: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const toSchema = (schema: z.ZodType, io: "input" | "output") =>
  z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
    target: "draft-2020-12",
  });

/** A response described by name and a few properties, for the types that
 * have no zod schema of their own. */
const shape = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
});

function components() {
  const note = toSchema(noteResponseSchema, "output");
  return {
    securitySchemes: {
      bearer: {
        type: "http",
        scheme: "bearer",
        description:
          "A session token from signing in, or a personal API token (mfp_...).",
      },
    },
    schemas: {
      Note: note,
      NoteResponse: shape({ note: { $ref: "#/components/schemas/Note" } }),
      NotesResponse: shape({
        notes: { type: "array", items: { $ref: "#/components/schemas/Note" } },
        nextCursor: { type: ["string", "null"] },
      }),
      Error: shape({ error: { type: "string" }, code: { type: "string" } }),
      Health: shape({ ok: { type: "boolean" }, version: { type: "string" } }),
      AuthMethodsResponse: shape({
        provider: { enum: ["local", "oidc"] },
        userLookup: { enum: ["search", "exact"] },
        webhooks: { type: "boolean" },
        passwordReset: { type: "boolean" },
        providers: { type: "array", items: { enum: ["local", "oidc"] } },
        passwordForm: { enum: ["shown", "collapsed"] },
      }),
      AuthSuccess: shape({
        token: { type: "string" },
        user: { type: "object" },
      }),
      AuthMeResponse: shape({ user: { type: "object" } }),
      TwoFactorStatusResponse: shape({
        enabled: { type: "boolean" },
        recoveryCodesRemaining: { type: "integer" },
      }),
      TwoFactorSetupResponse: shape({ secret: { type: "string" } }),
      TwoFactorRecoveryCodesResponse: shape({
        recoveryCodes: { type: "array", items: { type: "string" } },
      }),
      NoteVersionsResponse: shape({ versions: { type: "array" } }),
      InvitationsResponse: shape({ invitations: { type: "array" } }),
      UserLookupResponse: shape({ users: { type: "array" } }),
      LinkPreviewResponse: shape({ preview: { type: ["object", "null"] } }),
      ApiTokensResponse: shape({ tokens: { type: "array" } }),
      ApiTokenCreatedResponse: shape({
        token: { type: "object" },
        secret: { type: "string" },
      }),
      WebhooksResponse: shape({ webhooks: { type: "array" } }),
      WebhookCreatedResponse: shape({
        webhook: { type: "object" },
        secret: { type: "string" },
      }),
      AdminUsersResponse: shape({ users: { type: "array" } }),
      AdminOverviewResponse: shape({
        version: { type: "string" },
        uptimeSeconds: { type: "integer" },
        totals: { type: "object" },
        perUser: { type: "array" },
        jobs: { type: "array" },
      }),
      AuditLogResponse: shape({
        entries: { type: "array" },
        nextBefore: { type: ["string", "null"] },
      }),
      AdminUserResponse: shape({ user: { type: "object" } }),
      AdminTemporaryPasswordResponse: shape({
        user: { type: "object" },
        temporaryPassword: { type: "string" },
      }),
    },
  };
}

/** `/api/notes/:id` in the document's `{id}` form. */
export function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z]+)/g, "{$1}");
}

export function buildOpenApiDocument(version: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const path = openApiPath(op.path);
    const parameters = [
      ...[...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
      })),
      ...Object.entries(op.query ?? {}).map(([name, description]) => ({
        name,
        in: "query",
        description,
        schema: { type: "string" },
      })),
    ];
    paths[path] ??= {};
    paths[path][op.method] = {
      tags: [op.tag],
      summary: op.summary,
      ...(op.provider && {
        description: `Only when the server signs in with AUTH_PROVIDER=${op.provider}.`,
      }),
      security: op.auth === "none" ? [] : [{ bearer: [] }],
      ...(op.auth === "session" && {
        "x-session-only": true,
      }),
      ...(parameters.length > 0 && { parameters }),
      ...(op.body && {
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: toSchema(op.body, "input") },
          },
        },
      }),
      responses: Object.fromEntries(
        Object.entries(op.responses).map(([status, r]) => [
          status,
          {
            description: r.description,
            ...(r.schema && {
              content: {
                "application/json": {
                  schema: { $ref: `#/components/schemas/${r.schema}` },
                },
              },
            }),
          },
        ]),
      ),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Manifesto API",
      version,
      description:
        "The REST API of a Manifesto server. Two WebSockets sit beside it: /api/ws (note events and presence) and /api/yjs (collaborative editing); see docs/specification/api.md. Operations marked x-session-only refuse a personal API token.",
      license: { name: "MIT" },
    },
    servers: [{ url: "/" }],
    components: components(),
    paths,
  };
}
