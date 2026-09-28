import type { MiddlewareHandler } from "hono";
import type { AuthProvider, CredentialKind } from "../auth/types.js";
import { HttpError } from "./error.js";

export interface AuthContext {
  userId: string;
  token: string;
  via: CredentialKind;
  /** An MCP token offered only the tools that read. */
  readOnly?: boolean;
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

const READS = new Set(["GET", "HEAD"]);

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
      // The tools list already leaves out what writes; this holds even if a
      // tool were ever wrong about which it is.
      if (identity.readOnly && !READS.has(c.req.method)) {
        throw new HttpError(403, "This MCP token can only read");
      }
    }
    if (sessionOnly && identity.via !== "session") {
      throw new HttpError(403, "Sign in to do this; an API token cannot");
    }
    c.set("auth", {
      userId: identity.userId,
      token: identity.token,
      via: identity.via,
      ...(identity.readOnly !== undefined && { readOnly: identity.readOnly }),
    });
    await next();
  };
}
