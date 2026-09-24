import { zValidator } from "@hono/zod-validator";
import type {
  AuthMeResponse,
  AuthMethodsResponse,
  AuthProviderName,
} from "@manifesto/shared";
import { Hono } from "hono";
import {
  type ServerConfig,
  signsInLocally,
  signsInWithOidc,
} from "../config.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { emailTaken, HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import { authLocaleSchema, authMeUpdateSchema } from "../validation/schemas.js";
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
    const providers: AuthProviderName[] = [
      ...(signsInLocally(deps.cfg) ? (["local"] as const) : []),
      ...(signsInWithOidc(deps.cfg) ? (["oidc"] as const) : []),
    ];
    const body: AuthMethodsResponse = {
      // A client from before `providers` reads this alone; with both on,
      // single sign-on is the way in it can offer.
      provider: signsInWithOidc(deps.cfg) ? "oidc" : "local",
      providers,
      passwordForm:
        deps.cfg.authProvider === "both" ? deps.cfg.passwordForm : "shown",
      userLookup: deps.cfg.userLookup,
      webhooks: deps.cfg.webhooks !== "off",
      passwordReset: deps.cfg.mail !== null && signsInLocally(deps.cfg),
      registration: signsInLocally(deps.cfg) && deps.cfg.registrationEnabled,
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
    createAuthMiddleware(deps.authProvider, { sessionOnly: true }),
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

  /**
   * The language the client is set to, so mail another account's action sends
   * this one (a share invitation) is in it. The client reports it when it
   * differs from what `/me` said, which is on its first start and after the
   * user changes it.
   */
  router.put(
    "/me/locale",
    createAuthMiddleware(deps.authProvider),
    zValidator("json", authLocaleSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const { locale } = c.req.valid("json");
      if (!(await deps.storage.users.setLocale(userId, locale))) {
        throw new HttpError(401, "User not found");
      }
      return c.body(null, 204);
    },
  );

  return router;
}
