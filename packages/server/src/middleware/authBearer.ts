import { type ApiTokenScope, hasScope } from "@manifesto/shared";
import type { Context, MiddlewareHandler } from "hono";
import type { AuthProvider, CredentialKind } from "../auth/types.js";
import { OPERATIONS } from "../openapi.js";
import { HttpError } from "./error.js";

export interface AuthContext {
  userId: string;
  token: string;
  via: CredentialKind;
  /** What a token may reach; absent for a session. */
  scopes?: readonly ApiTokenScope[];
  /** When a session was signed in; absent for a token. */
  signedInAt?: string;
}

export interface AuthMiddlewareOptions {
  /**
   * Refuse a personal API token (403). For whatever changes how the account
   * is secured or reaches past it: passwords, tokens, the admin API.
   */
  sessionOnly?: boolean;
  /** Take an MCP token and nothing else: `/api/mcp` itself. */
  mcpOnly?: boolean;
}

/**
 * Set in the `env` of the REST requests `/api/mcp` makes in-process for its
 * tools, and nowhere else: a request from the network carries only what the
 * Node adapter puts there. An MCP token is accepted on a REST route only
 * with it, so a secret taken from an assistant's settings can do what the
 * tools do and no more.
 */
export const MCP_FORWARDED = Symbol("mcp-forwarded");

const BEARER_PREFIX = "Bearer ";

let scopeByRoute: Map<string, ApiTokenScope | undefined> | undefined;

/**
 * The scope `OPERATIONS` names for the route that will answer this request,
 * or undefined if it names none. `found` is false when no route matched, and
 * the request is on its way to a 404 anyway.
 */
function scopeFor(c: Context): { found: boolean; scope?: ApiTokenScope } {
  // Built on first use rather than at load: `openapi.ts` reaches the
  // validation schemas, and nothing here should depend on load order.
  scopeByRoute ??= new Map(
    OPERATIONS.map((op) => [`${op.method.toUpperCase()} ${op.path}`, op.scope]),
  );
  // A router's middleware already knows its handler: the last route matched
  // that is not middleware (`ALL`).
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
        throw new HttpError(403, "An MCP token works only at /api/mcp");
      }
    }
    if (sessionOnly && identity.via !== "session") {
      throw new HttpError(403, "Sign in to do this; an API token cannot");
    }
    // A token reaches only what its scopes name, and only routes that name
    // one: an operation declared without a scope is closed to tokens.
    if (identity.via !== "session") {
      const { found, scope } = scopeFor(c);
      if (found && scope === undefined) {
        throw new HttpError(403, "Sign in to do this; an API token cannot");
      }
      if (scope && !hasScope(identity.scopes ?? [], scope)) {
        throw new HttpError(403, `This token does not have the ${scope} scope`);
      }
    }
    c.set("auth", {
      userId: identity.userId,
      token: identity.token,
      via: identity.via,
      ...(identity.scopes && { scopes: identity.scopes }),
      ...(identity.signedInAt && { signedInAt: identity.signedInAt }),
    });
    await next();
  };
}
