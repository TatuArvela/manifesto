import type { MiddlewareHandler } from "hono";
import type { AuthProvider, CredentialKind } from "../auth/types.js";
import { HttpError } from "./error.js";

export interface AuthContext {
  userId: string;
  token: string;
  via: CredentialKind;
}

export interface AuthMiddlewareOptions {
  /**
   * Refuse a personal API token (403). For whatever changes how the account
   * is secured or reaches past it: passwords, tokens, the admin API.
   */
  sessionOnly?: boolean;
}

const BEARER_PREFIX = "Bearer ";

export function createAuthMiddleware(
  authProvider: AuthProvider,
  { sessionOnly = false }: AuthMiddlewareOptions = {},
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
    if (sessionOnly && identity.via !== "session") {
      throw new HttpError(403, "Sign in to do this; an API token cannot");
    }
    c.set("auth", {
      userId: identity.userId,
      token: identity.token,
      via: identity.via,
    });
    await next();
  };
}
