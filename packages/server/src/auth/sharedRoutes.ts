import { zValidator } from "@hono/zod-validator";
import {
  type AccountPrefsResponse,
  type AuditLogResponse,
  type AuthMeResponse,
  type AuthMethodsResponse,
  type AuthProviderName,
  MAX_ACCOUNT_PREFS_BYTES,
} from "@manifesto/shared";
import { Hono } from "hono";
import { auditPage } from "../audit/auditPage.js";
import {
  type ServerConfig,
  signsInLocally,
  signsInWithOidc,
} from "../config.js";
import { nowIso } from "../lib/time.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../middleware/authBearer.js";
import { emailTaken, HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import {
  accountPrefsUpdateSchema,
  authLocaleSchema,
  authMeUpdateSchema,
} from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";
import type { Broadcaster } from "../ws/broadcaster.js";
import { requireConfirmation } from "./confirmation.js";
import type { LoginAttempts } from "./local/loginAttempts.js";
import type { AuthProvider, AuthProviderRouter } from "./types.js";
import { toAuthUser } from "./users.js";

interface SharedAuthRoutesDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  authProvider: AuthProvider;
  /** Tells the account's other devices when its preferences change. */
  broadcaster?: Broadcaster;
  loginAttempts: LoginAttempts;
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
      publicLinks: deps.cfg.publicLinks,
      mcp: deps.cfg.mcp,
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
      const { email, password } = c.req.valid("json");
      const user = await deps.storage.users.findById(userId);
      if (!user) throw new HttpError(401, "User not found");
      if (user.provider !== "local") {
        throw new HttpError(
          409,
          "This account's email address comes from single sign-on",
        );
      }
      // A reset link goes to this address, so whoever sets it can take the
      // password next.
      await requireConfirmation(deps, c.get("auth"), password);
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
   * The signed-in user's own lines of the audit log: their sign-ins and
   * failed ones, changes to how the account is secured, shares, and anything
   * an admin did to the account, downloading its notes included. What an admin
   * can see about someone, that person can see too. A session only, like the
   * other pages about how the account is secured.
   */
  router.get(
    "/me/activity",
    createAuthMiddleware(deps.authProvider, { sessionOnly: true }),
    async (c) => {
      const { userId } = c.get("auth");
      const body: AuditLogResponse = await auditPage(
        deps.storage,
        { limit: c.req.query("limit"), before: c.req.query("before") },
        userId,
      );
      return c.json(body);
    },
  );

  /**
   * The account's preferences, so hidden tags and the rest follow it from
   * device to device. The server keeps what clients send and reads none of
   * it; each client parses what it gets back. Any credential, since a
   * preference changes nothing about how the account is secured.
   */
  router.get(
    "/me/prefs",
    createAuthMiddleware(deps.authProvider),
    async (c) => {
      const { userId } = c.get("auth");
      const body: AccountPrefsResponse = {
        prefs: await deps.storage.prefs.get(userId),
      };
      return c.json(body);
    },
  );

  /** Merges in the keys given, `null` removing one; `413` past the limit. */
  router.patch(
    "/me/prefs",
    createAuthMiddleware(deps.authProvider),
    zValidator("json", accountPrefsUpdateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const merged = await deps.storage.prefs.merge(
        userId,
        c.req.valid("json").prefs,
        nowIso(),
        MAX_ACCOUNT_PREFS_BYTES,
      );
      if (merged === "tooLarge") {
        throw new HttpError(413, "Preferences are too large");
      }
      // Every socket of the account hears it, the sender's included; it
      // adopts what it already has, which changes nothing.
      deps.broadcaster?.emit(userId, { type: "prefs:updated", prefs: merged });
      const body: AccountPrefsResponse = { prefs: merged };
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
