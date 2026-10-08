import { NoteColor, NoteFont } from "@manifesto/shared";
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
 * have no zod schema of their own. Nothing is marked required: this is the
 * client's own surface, described loosely. */
const shape = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
});

/**
 * A response of the public surface, described as a client generator needs
 * it: every property is required unless `optional` names it, so a generated
 * type says `string` and not `string | undefined`. `openapi.conformance.test.ts`
 * holds these to what the server actually answers.
 */
const exact = (
  properties: Record<string, unknown>,
  optional: readonly string[] = [],
) => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
});

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const listOf = (items: unknown) => ({ type: "array", items });
const nullable = (type: string) => ({ type: [type, "null"] });
const nullableRef = (name: string) => ({
  anyOf: [ref(name), { type: "null" }],
});

/** The people and shapes the public responses are made of. */
function publicParts() {
  const shareUser = {
    id: { type: "string" },
    username: { type: "string" },
    displayName: { type: "string" },
    avatarColor: { type: "string" },
  };
  const teamRef = exact({ id: { type: "string" }, name: { type: "string" } });
  return {
    // Named, so a generated client has one type for a color wherever a
    // response carries one.
    NoteColor: { type: "string", enum: Object.values(NoteColor) },
    NoteFont: { type: "string", enum: Object.values(NoteFont) },
    LinkPreview: exact(
      {
        url: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        image: { type: "string" },
        favicon: { type: "string" },
        domain: { type: "string" },
      },
      ["description", "image", "favicon"],
    ),
    ShareUser: exact(shareUser),
    NoteMember: exact(
      {
        ...shareUser,
        role: { enum: ["edit", "view"] },
        accepted: { type: "boolean" },
        team: teamRef,
      },
      ["team"],
    ),
    NoteSharing: exact({
      role: { enum: ["owner", "edit", "view"] },
      owner: ref("ShareUser"),
      members: listOf(ref("NoteMember")),
    }),
    ShareInvitation: exact(
      {
        noteId: { type: "string" },
        role: { enum: ["edit", "view"] },
        owner: ref("ShareUser"),
        title: { type: "string" },
        content: { type: "string" },
        color: ref("NoteColor"),
        font: ref("NoteFont"),
        invitedAt: { type: "string" },
        team: teamRef,
      },
      ["team"],
    ),
    DirectoryUser: exact({ ...shareUser, email: { type: "string" } }, [
      "email",
    ]),
    AuthUser: exact(
      {
        ...shareUser,
        email: nullable("string"),
        isAdmin: { type: "boolean" },
        hasPassword: { type: "boolean" },
        locale: nullable("string"),
      },
      ["hasPassword", "locale"],
    ),
    NoteVersion: exact({
      noteId: { type: "string" },
      timestamp: { type: "string" },
      title: { type: "string" },
      content: { type: "string" },
    }),
    NoteComment: exact({
      id: { type: "string" },
      noteId: { type: "string" },
      // Null once whoever wrote it no longer has the note.
      author: nullableRef("ShareUser"),
      body: { type: "string" },
      createdAt: { type: "string" },
      editedAt: nullable("string"),
    }),
  };
}

function components() {
  // The note itself comes from the zod schema; who it is shared with is the
  // one part of it described by hand, and its color and font point at the
  // named enums the other responses use.
  const converted = toSchema(noteResponseSchema, "output") as {
    properties: Record<string, unknown>;
  };
  const note = {
    ...converted,
    properties: {
      ...converted.properties,
      color: ref("NoteColor"),
      font: ref("NoteFont"),
      sharing: ref("NoteSharing"),
    },
  };
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
      ...publicParts(),
      Note: note,
      NoteResponse: exact({ note: ref("Note") }),
      NotesResponse: exact({
        notes: listOf(ref("Note")),
        nextCursor: nullable("string"),
      }),
      SyncResponse: exact({
        notes: listOf(ref("Note")),
        nextCursor: nullable("string"),
        ids: { type: ["array", "null"], items: { type: "string" } },
        checkpoint: nullable("string"),
      }),
      TeamsResponse: exact({
        teams: listOf(
          exact({
            id: { type: "string" },
            name: { type: "string" },
            source: { enum: ["local", "oidc"] },
            memberCount: { type: "integer" },
          }),
        ),
      }),
      TeamSharesResponse: exact({
        teamShares: listOf(
          exact({
            teamId: { type: "string" },
            name: { type: "string" },
            role: { enum: ["edit", "view"] },
          }),
        ),
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
      PublicLink: exact({
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
      PublicLinkResponse: exact({ link: ref("PublicLink") }),
      PublicLinksResponse: exact({ links: listOf(ref("PublicLink")) }),
      PublicNoteResponse: exact(
        {
          note: exact({
            title: { type: "string" },
            content: { type: "string" },
            color: ref("NoteColor"),
            font: ref("NoteFont"),
            images: listOf({ type: "string" }),
            linkPreviews: listOf(ref("LinkPreview")),
            updatedAt: { type: "string" },
          }),
          access: nullable("string"),
        },
        ["access"],
      ),
      PublicNoteLockedResponse: exact({ passwordRequired: { const: true } }),
      NotesImportResponse: exact({
        created: { type: "integer" },
        updated: { type: "integer" },
        skipped: { type: "integer" },
      }),
      Error: exact({ error: { type: "string" }, code: { type: "string" } }, [
        "code",
      ]),
      Health: exact({ ok: { type: "boolean" }, version: { type: "string" } }),
      AuthSuccess: shape({
        token: { type: "string" },
        user: { type: "object" },
      }),
      TwoFactorRequired: shape({
        error: { type: "string" },
        code: { const: "two_factor_required" },
        twoFactor: shape({
          authenticator: { type: "boolean" },
          passkey: { type: ["object", "null"] },
        }),
      }),
      AuthMeResponse: exact({ user: ref("AuthUser") }),
      CapabilitiesResponse: exact({
        version: { type: "string" },
        auth: exact(
          {
            providers: listOf({ enum: ["local", "oidc"] }),
            passwordForm: { enum: ["shown", "collapsed"] },
            registration: { type: "boolean" },
            passwordReset: { type: "boolean" },
            magicLink: { type: "boolean" },
            passkeys: { type: "boolean" },
          },
          ["magicLink"],
        ),
        // One boolean a feature, and `userLookup`, which is a word. Features
        // are added over time, so they are not listed one by one.
        features: {
          type: "object",
          properties: { userLookup: { enum: ["search", "exact"] } },
          required: ["userLookup"],
          additionalProperties: { type: "boolean" },
        },
        limits: { type: "object", additionalProperties: { type: "integer" } },
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
      NoteVersionsResponse: exact({ versions: listOf(ref("NoteVersion")) }),
      InvitationsResponse: exact({
        invitations: listOf(ref("ShareInvitation")),
      }),
      NoteCommentsResponse: exact({ comments: listOf(ref("NoteComment")) }),
      NoteCommentResponse: exact({ comment: ref("NoteComment") }),
      UserLookupResponse: exact({ users: listOf(ref("DirectoryUser")) }),
      LinkPreviewResponse: exact({ preview: nullableRef("LinkPreview") }),
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
      AttachmentUploadResponse: exact({ ref: { type: "string" } }),
      AdminOverviewResponse: shape({
        version: { type: "string" },
        uptimeSeconds: { type: "integer" },
        totals: { type: "object" },
        perUser: { type: "array" },
        jobs: { type: "array" },
      }),
      AdminChecksResponse: shape({
        appUrl: { type: ["string", "null"] },
        trustProxy: { type: "boolean" },
        proxy: {
          type: "string",
          enum: ["untouched", "overwritten", "appended", "removed"],
        },
        backup: { type: ["object", "null"] },
        mail: { type: ["object", "null"] },
      }),
      AdminTestMailResponse: shape({ sent: { type: "boolean" } }),
      AccountPrefsResponse: exact({ prefs: { type: "object" } }),
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

/**
 * The name a generated client gives an operation's method: the HTTP method and
 * the path's words, `getNotesById` for `GET /api/notes/:id`. Derived, so it
 * exists for every operation and changes only when its route does.
 */
export function operationId(op: Pick<Operation, "method" | "path">): string {
  const words = op.path
    .replace(/^\/api\//, "")
    .split(/[/.\-_]/)
    .filter(Boolean)
    .map((part) => (part.startsWith(":") ? `By ${part.slice(1)}` : part))
    .flatMap((part) => part.split(" "))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return op.method + words.join("");
}

/** Query parameters that are numbers; the rest are strings. */
const INTEGER_QUERY = new Set(["limit"]);

/** `/api/notes/:id` in the document's `{id}` form. */
export function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z]+)/g, "{$1}");
}

/**
 * A request schema as it can sit inside the document. zod puts a schema that
 * refers to itself (`z.json()`, any JSON value) under `$defs` and points at it
 * with `#/$defs/...`, which is right for a schema standing alone and dangling
 * once it is embedded: the `#` is then the whole document. Each such
 * definition moves to `components.schemas`, named by `name`, and the
 * references follow it.
 */
function embeddable(
  schema: unknown,
  hoisted: Record<string, unknown>,
  name: (key: string) => string,
): unknown {
  const defs = (schema as { $defs?: Record<string, unknown> }).$defs;
  if (!defs) return schema;
  const moved = (value: unknown): unknown => {
    let text = JSON.stringify(value);
    for (const key of Object.keys(defs)) {
      text = text.replaceAll(
        `"#/$defs/${key}"`,
        `"#/components/schemas/${name(key)}"`,
      );
    }
    return JSON.parse(text);
  };
  for (const [key, def] of Object.entries(defs)) {
    hoisted[name(key)] = moved(def);
  }
  const { $defs: _moved, ...rest } = schema as Record<string, unknown>;
  return moved(rest);
}

export function buildOpenApiDocument(version: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  /** Definitions lifted out of request schemas, see `embeddable`. */
  const hoisted: Record<string, unknown> = {};
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
        schema: { type: INTEGER_QUERY.has(name) ? "integer" : "string" },
      })),
    ];
    paths[path] ??= {};
    paths[path][op.method] = {
      operationId: operationId(op),
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
            "application/json": {
              schema: embeddable(
                toSchema(op.body, "input"),
                hoisted,
                // `__schema0` of `PATCH /api/auth/me/prefs` becomes
                // `PatchAuthMePrefsSchema0`: unique, and stable.
                (key) => {
                  const id = operationId(op);
                  return `${id.charAt(0).toUpperCase()}${id.slice(1)}${key
                    .replace(/^_+/, "")
                    .replace(/^./, (c) => c.toUpperCase())}`;
                },
              ),
            },
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
    components: (() => {
      const base = components();
      return { ...base, schemas: { ...base.schemas, ...hoisted } };
    })(),
    paths,
  };
}
