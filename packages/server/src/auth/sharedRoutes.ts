import type { AuthMeResponse, AuthMethodsResponse } from "@manifesto/shared";
import { Hono } from "hono";
import type { ServerConfig } from "../config.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import type { AuthProvider, AuthProviderRouter } from "./types.js";

interface SharedAuthRoutesDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  authProvider: AuthProvider;
}

/**
 * Provider-agnostic auth endpoints. Mounted alongside the active provider's
 * router so the client can discover which login UI to render and refresh the
 * current user from a bearer token (used after an OIDC callback when the only
 * thing the client gets is a token in the URL fragment).
 */
export function createAuthSharedRoutes(
  deps: SharedAuthRoutesDeps,
): AuthProviderRouter {
  const router = new Hono<{ Variables: { auth: AuthContext } }>();

  router.get("/methods", (c) => {
    const body: AuthMethodsResponse = { provider: deps.cfg.authProvider };
    return c.json(body);
  });

  router.get("/me", createAuthMiddleware(deps.authProvider), async (c) => {
    const { userId } = c.get("auth");
    const user = await deps.storage.users.findById(userId);
    if (!user) {
      throw new HttpError(401, "User not found");
    }
    const body: AuthMeResponse = {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        avatarColor: user.avatarColor,
      },
    };
    return c.json(body);
  });

  return router;
}
