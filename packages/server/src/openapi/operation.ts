import type { ApiTokenScope, ServerFeature } from "@manifesto/shared";
import type { z } from "zod";
import type { Bucket } from "#/middleware/protect.ts";

type Auth = "none" | "any" | "session" | "mcp" | "admin";

export interface Operation {
  method: "get" | "post" | "put" | "patch" | "delete";
  /** The form of Hono, `:id`. The document writes it as `{id}`. */
  path: string;
  tag: string;
  summary: string;
  /**
   * Who can call it. `middleware/protect.ts` enforces this from here. `none`:
   * all persons. `any`: any credential (a session, or a token within `scope`).
   * `session`: only a sign-in session, refused to an API token. `admin`: the
   * session of an admin. `mcp`: only an MCP token.
   */
  auth: Auth;
  /**
   * The rate-limit buckets that it uses (`BUCKETS` in `middleware/protect.ts`),
   * also enforced from here. It is required. Thus, you cannot add a route
   * without it. An empty list says that it has none.
   */
  limits: readonly Bucket[];
  /**
   * What a token needs to call it. Required where `auth` is `any` or `mcp`
   * (`openapi.test.ts` checks that). The server refuses a token an operation
   * that names none. Thus, a route added without one is closed to tokens, not
   * open.
   */
  scope?: ApiTokenScope;
  /**
   * The feature to which it belongs (`FEATURES` in `features.ts`). While that
   * feature is off, `middleware/protect.ts` answers it with the 404 of a route
   * that does not exist, before all other checks. Not set on the ways out of a
   * feature (to remove a person from a note, to remove a passkey, to turn off
   * two-factor), which stay open whatever the switch says.
   */
  feature?: ServerFeature;
  body?: z.ZodType;
  query?: Record<string, string>;
  /** Status to description. `schema` names a component. */
  responses: Record<string, { description: string; schema?: string }>;
  /** Registered only with this auth provider. */
  provider?: "local" | "oidc";
  /**
   * The release that deprecated it, and what to use in its place. From 1.0.0, a
   * deprecated operation continues to work for a minimum of two minor releases
   * after that one (the compatibility policy in `api.md`). Before, it is only a
   * notice.
   */
  deprecated?: { since: string; use?: string };
}

/**
 * The operations on which all clients other than the own web client of this
 * server rely, which the compatibility policy in `api.md` covers: all that a
 * token can call (a scope names it, also `/api/v1/mcp`), and these, which
 * programs call without a credential. All other operations are the own surface
 * of the client.
 */
const PUBLIC_WITHOUT_CREDENTIAL = new Set([
  "/api/v1/health",
  "/api/v1/capabilities",
  "/api/v1/openapi.json",
  "/api/v1/calendar/:file",
  "/api/v1/public/:token",
  "/api/v1/public/:token/unlock",
  "/api/v1/public/:token/attachments/:id",
  "/api/v1/oauth/register",
  "/api/v1/oauth/token",
]);

export function isPublicSurface(op: Operation): boolean {
  return op.scope !== undefined || PUBLIC_WITHOUT_CREDENTIAL.has(op.path);
}

export const ok = (schema?: string) => ({
  "200": { description: "OK", ...(schema && { schema }) },
});
export const noContent = { "204": { description: "Done" } };
export const notFound = {
  "404": { description: "Not found", schema: "Error" },
};
