import {
  type AccountSealKeys,
  type ApiTokenScope,
  hasScope,
  unwrapTokenKeys,
} from "@manifesto/shared";
import type { Context, MiddlewareHandler } from "hono";
import type { AuthProvider, CredentialKind } from "#/auth/types.ts";
import { OPERATIONS } from "#/openapi.ts";
import { HttpError } from "./error.ts";

export interface AuthContext {
  userId: string;
  token: string;
  via: CredentialKind;
  /** What a token can reach. Absent for a session. */
  scopes?: readonly ApiTokenScope[];
  /** When a session signed in. Absent for a token. */
  signedInAt?: string;
  /**
   * The keys of a token, opened for this request with the presented token. The
   * server opens and seals the notes of that account with them while the
   * request runs, and never keeps them. Absent for a session, which sends no
   * key, and for a token that has none.
   */
  keys?: AccountSealKeys;
}

export interface AuthMiddlewareOptions {
  /**
   * Refuse a personal API token (403). For all actions that change the security
   * of the account, or reach past it: passwords, tokens, the admin API.
   */
  sessionOnly?: boolean;
  /** Accept an MCP token and nothing else: `/api/v1/mcp` itself. */
  mcpOnly?: boolean;
}

/**
 * Set in the `env` of the REST requests that `/api/v1/mcp` makes in the process
 * for its tools, and in no other place. A request from the network contains
 * only what the Node adapter puts there. A REST route accepts an MCP token only
 * with it. Thus, a secret taken from the settings of an assistant can do only
 * what the tools do.
 */
export const MCP_FORWARDED = Symbol("mcp-forwarded");

const BEARER_PREFIX = "Bearer ";

let scopeByRoute: Map<string, ApiTokenScope | undefined> | undefined;

/**
 * The scope that `OPERATIONS` names for the route that will answer this
 * request, or undefined if it names none. `found` is false when no route
 * matched, and the request will get a 404 anyway.
 */
function scopeFor(c: Context): {
  found: boolean;
  scope?: ApiTokenScope | undefined;
} {
  // Built on the first use, not at load. `openapi.ts` reaches the validation
  // schemas, and nothing here must depend on the load order.
  scopeByRoute ??= new Map(
    OPERATIONS.map((op) => [`${op.method.toUpperCase()} ${op.path}`, op.scope]),
  );
  // The middleware of a router already knows its handler: the last matched
  // route that is not middleware (`ALL`).
  const route = c.req.matchedRoutes.findLast((r) => r.method !== "ALL");
  if (!route) return { found: false };
  return {
    found: true,
    scope: scopeByRoute.get(`${route.method} ${route.path}`),
  };
}

export function createAuthMiddleware(
  authProvider: AuthProvider,
  { sessionOnly = false, mcpOnly = false }: AuthMiddlewareOptions = {},
): MiddlewareHandler<{ Variables: { auth: AuthContext } }> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith(BEARER_PREFIX)) {
      throw new HttpError(401, "Missing bearer token");
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    if (token.length === 0) {
      throw new HttpError(401, "Empty bearer token");
    }
    const identity = await authProvider.authenticate(token);
    if (!identity) {
      throw new HttpError(401, "Invalid or expired session");
    }
    if (mcpOnly) {
      if (identity.via !== "mcp-token") {
        throw new HttpError(403, "Only an MCP token (mfm_...) works here");
      }
    } else if (identity.via === "mcp-token") {
      const forwarded =
        (c.env as Record<symbol, unknown> | undefined)?.[MCP_FORWARDED] ===
        true;
      if (!forwarded) {
        throw new HttpError(403, "An MCP token works only at /api/v1/mcp");
      }
    }
    if (sessionOnly && identity.via !== "session") {
      throw new HttpError(403, "Sign in to do this; an API token cannot");
    }
    // A token reaches only what its scopes name, and only routes that name one.
    // Tokens cannot use an operation declared without a scope.
    if (identity.via !== "session") {
      const { found, scope } = scopeFor(c);
      if (found && scope === undefined) {
        throw new HttpError(403, "Sign in to do this; an API token cannot");
      }
      if (scope && !hasScope(identity.scopes ?? [], scope)) {
        throw new HttpError(403, `This token does not have the ${scope} scope`);
      }
    }
    const keys = identity.wrappedKeys
      ? await unwrapTokenKeys(
          identity.token,
          identity.wrappedKeys,
          identity.userId,
        )
      : null;
    c.set("auth", {
      userId: identity.userId,
      token: identity.token,
      via: identity.via,
      ...(identity.scopes && { scopes: identity.scopes }),
      ...(identity.signedInAt && { signedInAt: identity.signedInAt }),
      ...(keys && { keys }),
    });
    await next();
  };
}
