import { z } from "zod";
import { ACCOUNT_OPERATIONS } from "./openapi/account.js";
import { ADMIN_OPERATIONS } from "./openapi/admin.js";
import { AUTH_OPERATIONS } from "./openapi/auth.js";
import { AUTH_FACTOR_OPERATIONS } from "./openapi/authFactors.js";
import { MCP_OPERATIONS } from "./openapi/mcp.js";
import { NOTE_OPERATIONS } from "./openapi/notes.js";
import { isPublicSurface, type Operation } from "./openapi/operation.js";
import { SERVER_OPERATIONS } from "./openapi/server.js";
import { SHARING_OPERATIONS } from "./openapi/sharing.js";
import { noteCreateSchema } from "./validation/schemas.js";

export { isPublicSurface, type Operation } from "./openapi/operation.js";

/**
 * The API as an OpenAPI 3.1 document, served at `GET /api/openapi.json`.
 *
 * Request bodies are not described here: they are the zod schemas the routes
 * validate with, converted, so a change to what a route accepts changes the
 * document with it. What this file adds is the list of operations (one module
 * per area in `openapi/`), and `openapi.test.ts` holds that list to the routes
 * the app actually registers, in both directions, so an endpoint cannot be
 * added or removed without the document following. Response bodies are named after the types in
 * `@manifesto/shared/api.ts`; the notes are described in full, the rest by
 * name and shape.
 */

/** Every operation, area by area, in the order the document lists them. */
export const OPERATIONS: Operation[] = [
  ...SERVER_OPERATIONS,
  ...AUTH_OPERATIONS,
  ...AUTH_FACTOR_OPERATIONS,
  ...NOTE_OPERATIONS,
  ...SHARING_OPERATIONS,
  ...ACCOUNT_OPERATIONS,
  ...ADMIN_OPERATIONS,
  ...MCP_OPERATIONS,
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
          "A session token from signing in, or a personal API token (mfp_...), which reaches only the operations whose x-token-scope it was granted (a :write scope includes its :read). /api/mcp takes an MCP token (mfm_...) and nothing else, minted by hand or given to an assistant through /api/oauth, whose refresh token (mfr_...) is not a bearer token; a calendar token (mfc_...) is not a bearer token at all: it is the address of /api/calendar/<token>.ics.",
      },
    },
    schemas: {
      Note: note,
      NoteResponse: shape({ note: { $ref: "#/components/schemas/Note" } }),
      NotesResponse: shape({
        notes: { type: "array", items: { $ref: "#/components/schemas/Note" } },
        nextCursor: { type: ["string", "null"] },
      }),
      SyncResponse: shape({
        notes: { type: "array", items: { $ref: "#/components/schemas/Note" } },
        nextCursor: { type: ["string", "null"] },
        ids: { type: ["array", "null"], items: { type: "string" } },
        checkpoint: { type: ["string", "null"] },
      }),
      TeamsResponse: shape({
        teams: {
          type: "array",
          items: shape({
            id: { type: "string" },
            name: { type: "string" },
            source: { enum: ["local", "oidc"] },
            memberCount: { type: "integer" },
          }),
        },
      }),
      TeamSharesResponse: shape({
        teamShares: {
          type: "array",
          items: shape({
            teamId: { type: "string" },
            name: { type: "string" },
            role: { enum: ["edit", "view"] },
          }),
        },
      }),
      AdminTeamsResponse: shape({
        teams: {
          type: "array",
          items: { $ref: "#/components/schemas/AdminTeam" },
        },
      }),
      AdminTeamResponse: shape({
        team: { $ref: "#/components/schemas/AdminTeam" },
      }),
      AdminTeam: shape({
        id: { type: "string" },
        name: { type: "string" },
        source: { enum: ["local", "oidc"] },
        memberCount: { type: "integer" },
        members: { type: "array", items: { type: "object" } },
        createdAt: { type: "string" },
      }),
      PublicLink: shape({
        token: { type: "string" },
        noteId: { type: "string" },
        mode: { enum: ["live", "snapshot"] },
        expiresAt: { type: ["string", "null"] },
        hasPassword: { type: "boolean" },
        maxViews: { type: ["integer", "null"] },
        viewCount: { type: "integer" },
        lastViewedAt: { type: ["string", "null"] },
        createdAt: { type: "string" },
      }),
      PublicLinkResponse: shape({
        link: { $ref: "#/components/schemas/PublicLink" },
      }),
      PublicLinksResponse: shape({
        links: {
          type: "array",
          items: { $ref: "#/components/schemas/PublicLink" },
        },
      }),
      PublicNoteResponse: shape({
        note: shape({
          title: { type: "string" },
          content: { type: "string" },
          color: { type: "string" },
          font: { type: "string" },
          images: { type: "array", items: { type: "string" } },
          linkPreviews: { type: "array", items: { type: "object" } },
          updatedAt: { type: "string" },
        }),
        access: { type: ["string", "null"] },
      }),
      PublicNoteLockedResponse: shape({ passwordRequired: { const: true } }),
      NotesImportResponse: shape({
        created: { type: "integer" },
        updated: { type: "integer" },
        skipped: { type: "integer" },
      }),
      Error: shape({ error: { type: "string" }, code: { type: "string" } }),
      Health: shape({ ok: { type: "boolean" }, version: { type: "string" } }),
      AuthSuccess: shape({
        token: { type: "string" },
        user: { type: "object" },
      }),
      AuthMeResponse: shape({ user: { type: "object" } }),
      CapabilitiesResponse: shape({
        version: { type: "string" },
        auth: { type: "object" },
        features: { type: "object" },
        limits: { type: "object" },
        editorSchemaVersion: { type: "integer" },
      }),
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
      OAuthClientInfo: shape({
        clientId: { type: "string" },
        name: { type: "string" },
        publisher: { type: ["string", "null"] },
        redirectUri: { type: "string" },
        scopes: { type: "array" },
      }),
      OAuthAuthorizeResponse: shape({ redirectTo: { type: "string" } }),
      PasskeysResponse: shape({ passkeys: { type: "array" } }),
      PasskeyOptionsResponse: shape({ options: { type: "object" } }),
      PasskeyAddedResponse: shape({
        passkey: { type: "object" },
        recoveryCodes: { type: ["array", "null"] },
      }),
      PasskeySignInOptionsResponse: shape({ options: { type: "object" } }),
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
      AttachmentUploadResponse: shape({ ref: { type: "string" } }),
      AdminOverviewResponse: shape({
        version: { type: "string" },
        uptimeSeconds: { type: "integer" },
        totals: { type: "object" },
        perUser: { type: "array" },
        jobs: { type: "array" },
      }),
      AccountPrefsResponse: shape({ prefs: { type: "object" } }),
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
      ...((op.auth === "session" || op.auth === "admin") && {
        "x-session-only": true,
      }),
      ...(op.auth === "admin" && { "x-admin-only": true }),
      ...(op.auth === "mcp" && { "x-mcp-only": true }),
      ...(op.limits.length > 0 && { "x-rate-limits": op.limits }),
      ...(op.scope && { "x-token-scope": op.scope }),
      ...(op.feature && { "x-feature": op.feature }),
      "x-stability": isPublicSurface(op) ? "public" : "client",
      ...(op.deprecated && {
        deprecated: true,
        "x-deprecated-since": op.deprecated.since,
        ...(op.deprecated.use && { "x-use-instead": op.deprecated.use }),
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
        "The REST API of a Manifesto server. Two WebSockets sit beside it: /api/ws (note events and presence) and /api/yjs (collaborative editing); see docs/specification/api.md. Operations marked x-session-only refuse a personal API token; /api/mcp (x-mcp-only) is the Model Context Protocol endpoint, see docs/specification/features/mcp.md. An operation marked x-feature belongs to a feature the host can turn off, and answers 404 while it is (features in /api/capabilities). x-stability says whether the compatibility policy in docs/specification/api.md will cover an operation from 1.0.0 (public) or it is the web client's own (client); before 1.0.0 any of it may change.",
      license: { name: "MIT" },
    },
    servers: [{ url: "/" }],
    components: components(),
    paths,
  };
}
