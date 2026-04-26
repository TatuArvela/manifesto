import type { MiddlewareHandler } from "hono";
import type { AuthProvider } from "../auth/types.js";
import { HttpError } from "./error.js";

export interface AuthContext {
  userId: string;
  token: string;
}

const BEARER_PREFIX = "Bearer ";

export function createAuthMiddleware(
  authProvider: AuthProvider,
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
    c.set("auth", { userId: identity.userId, token: identity.token });
    await next();
  };
}
