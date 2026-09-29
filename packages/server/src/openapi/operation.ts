import type { ApiTokenScope, ServerFeature } from "@manifesto/shared";
import type { z } from "zod";
import type { Bucket } from "../middleware/protect.js";

type Auth = "none" | "any" | "session" | "mcp" | "admin";

export interface Operation {
  method: "get" | "post" | "put" | "patch" | "delete";
  /** Hono's form, `:id`; written as `{id}` in the document. */
  path: string;
  tag: string;
  summary: string;
  /**
   * Who may call it, enforced from here by `middleware/protect.ts`: `none`,
   * anyone; `any`, any credential (a session, or a token within `scope`);
   * `session`, a sign-in session only, refused to an API token; `admin`, an
   * admin's session; `mcp`, an MCP token only.
   */
  auth: Auth;
  /**
   * The rate-limit buckets it draws from (`BUCKETS` in `middleware/protect.ts`),
   * also enforced from here. Required, so a route cannot be added without
   * saying; an empty list says it has none.
   */
  limits: readonly Bucket[];
  /**
   * What a token needs to call it. Required where `auth` is `any` or `mcp`
   * (`openapi.test.ts` holds to that); a token is refused an operation that
   * names none, so a route added without one is closed to tokens, not open.
   */
  scope?: ApiTokenScope;
  /**
   * The feature it belongs to (`FEATURES` in `features.ts`). While that is
   * off, `middleware/protect.ts` answers it with the 404 of a route that does
   * not exist, before anything else. Left off the ways out of a feature
   * (taking someone off a note, removing a passkey, turning two-factor off),
   * which stay open whatever the switch says.
   */
  feature?: ServerFeature;
  body?: z.ZodType;
  query?: Record<string, string>;
  /** Status to description; `schema` names a component. */
  responses: Record<string, { description: string; schema?: string }>;
  /** Registered only under this auth provider. */
  provider?: "local" | "oidc";
  /**
   * The release that deprecated it, and what to use instead. From 1.0.0 a
   * deprecated operation keeps working for at least two minor releases after
   * that one (the compatibility policy in `api.md`); before, it is a notice.
   */
  deprecated?: { since: string; use?: string };
}

/**
 * The operations anything other than this server's own web client relies on,
 * which the compatibility policy in `api.md` covers: whatever a token can
 * call (a scope names it, `/api/mcp` included), and these, which programs
 * call with no credential. Everything else is the client's own surface.
 */
const PUBLIC_WITHOUT_CREDENTIAL = new Set([
  "/api/health",
  "/api/capabilities",
  "/api/openapi.json",
  "/api/calendar/:file",
  "/api/public/:token",
  "/api/public/:token/unlock",
  "/api/public/:token/attachments/:id",
  "/api/oauth/register",
  "/api/oauth/token",
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
