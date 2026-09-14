import { zValidator } from "@hono/zod-validator";
import type { AuthMeResponse, AuthMethodsResponse } from "@manifesto/shared";
import { Hono } from "hono";
import type { ServerConfig } from "../config.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { emailTaken, HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import { authMeUpdateSchema } from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";
import type { AuthProvider, AuthProviderRouter } from "./types.js";
import { toAuthUser } from "./users.js";

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
    const body: AuthMethodsResponse = {
      provider: deps.cfg.authProvider,
      userLookup: deps.cfg.userLookup,
    };
    return c.json(body);
  });

  router.get("/me", createAuthMiddleware(deps.authProvider), async (c) => {
    const { userId } = c.get("auth");
    const user = await deps.storage.users.findById(userId);
    if (!user) {
      throw new HttpError(401, "User not found");
    }
    const body: AuthMeResponse = { user: toAuthUser(user) };
    return c.json(body);
  });

  /**
   * The signed-in user's own details; today, only the email address. An
   * account that signs in through an identity provider takes its address from
   * there on every sign-in, so it cannot set one here (`409`).
   */
  router.put(
    "/me",
    createAuthMiddleware(deps.authProvider),
    zValidator("json", authMeUpdateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const { email } = c.req.valid("json");
      const user = await deps.storage.users.findById(userId);
      if (!user) throw new HttpError(401, "User not found");
      if (user.provider !== "local") {
        throw new HttpError(
          409,
          "This account's email address comes from single sign-on",
        );
      }
      const result = await deps.storage.users.setEmail(userId, email);
      if (result === "not-found") throw new HttpError(401, "User not found");
      if (result === "email-taken") throw emailTaken();
      const body: AuthMeResponse = {
        user: toAuthUser({ ...user, email }),
      };
      return c.json(body);
    },
  );

  return router;
}
