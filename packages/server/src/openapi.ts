import { ACCOUNT_OPERATIONS } from "./openapi/account.ts";
import { ADMIN_OPERATIONS } from "./openapi/admin.ts";
import { AUTH_OPERATIONS } from "./openapi/auth.ts";
import { AUTH_FACTOR_OPERATIONS } from "./openapi/authFactors.ts";
import { components, toSchema } from "./openapi/components.ts";
import { KEY_OPERATIONS } from "./openapi/keys.ts";
import { MCP_OPERATIONS } from "./openapi/mcp.ts";
import { NOTE_OPERATIONS } from "./openapi/notes.ts";
import { isPublicSurface, type Operation } from "./openapi/operation.ts";
import { SERVER_OPERATIONS } from "./openapi/server.ts";
import { SHARING_OPERATIONS } from "./openapi/sharing.ts";

export { isPublicSurface, type Operation } from "./openapi/operation.ts";

/**
 * The API as an OpenAPI 3.1 document, served at `GET /api/v1/openapi.json`.
 *
 * This file does not describe request bodies. They are the converted zod
 * schemas with which the routes validate. Thus, a change to what a route
 * accepts also changes the document. This file adds the list of operations (one
 * module for each area in `openapi/`). `openapi.test.ts` compares that list
 * with the routes that the app really registers, in both directions. Thus, you
 * cannot add or remove an endpoint unless the document follows. Response bodies
 * have the names of the types in `@manifesto/shared/api.ts`. The notes have a
 * full description. The others have only a name and a shape.
 */

/** All operations, area by area, in the order of the document. */
export const OPERATIONS: Operation[] = [
  ...SERVER_OPERATIONS,
  ...AUTH_OPERATIONS,
  ...AUTH_FACTOR_OPERATIONS,
  ...KEY_OPERATIONS,
  ...NOTE_OPERATIONS,
  ...SHARING_OPERATIONS,
  ...ACCOUNT_OPERATIONS,
  ...ADMIN_OPERATIONS,
  ...MCP_OPERATIONS,
];

/**
 * The name that a generated client gives the method of an operation: the HTTP
 * method and the words of the path, `getNotesById` for `GET /api/v1/notes/:id`.
 * It is derived. Thus, it exists for each operation, and changes only when its
 * route changes.
 */
export function operationId(op: Pick<Operation, "method" | "path">): string {
  const words = op.path
    .replace(/^\/api\/v1\//, "")
    .split(/[/.\-_]/)
    .filter(Boolean)
    .map((part) => (part.startsWith(":") ? `By ${part.slice(1)}` : part))
    .flatMap((part) => part.split(" "))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return op.method + words.join("");
}

/** Query parameters that are numbers. The others are strings. */
const INTEGER_QUERY = new Set(["limit"]);

/** `/api/v1/notes/:id` in the `{id}` form of the document. */
export function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z]+)/g, "{$1}");
}

/**
 * A request schema in a form that can be inside the document. zod puts a schema
 * that refers to itself (`z.json()`, any JSON value) under `$defs`, and points
 * to it with `#/$defs/...`. That is correct for a schema alone, but broken
 * after it is embedded, because the `#` is then the full document. Each such
 * definition moves to `components.schemas`, with the name `name`, and the
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
  /** Definitions taken out of request schemas. See `embeddable`. */
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
                // `__schema0` of `PATCH /api/v1/auth/me/prefs` becomes
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
        "The REST API of a Manifesto server. Two WebSockets sit beside it: /api/v1/ws (note events and presence) and /api/v1/yjs (collaborative editing); see docs/specification/api.md. Operations marked x-session-only refuse a personal API token; /api/v1/mcp (x-mcp-only) is the Model Context Protocol endpoint, see docs/specification/features/mcp.md. An operation marked x-feature belongs to a feature the host can turn off, and answers 404 while it is (features in /api/v1/capabilities). x-stability says whether the compatibility policy in docs/specification/api.md will cover an operation from 1.0.0 (public) or it is the web client's own (client); before 1.0.0 any of it may change.",
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
