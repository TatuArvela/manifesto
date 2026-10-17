import { zValidator } from "@hono/zod-validator";
import {
  type AuditLogResponse,
  type AuthMeResponse,
  MAX_SEALED_ACCOUNT_PREFS_BYTES,
  type SealedAccountPrefs,
  type SealedAccountPrefsResponse,
} from "@manifesto/shared";
import { Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import { auditPage } from "#/audit/auditPage.ts";
import type { ServerConfig } from "#/config.ts";
import { logger } from "#/lib/logger.ts";
import { nowIso } from "#/lib/time.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { emailTaken, HttpError } from "#/middleware/error.ts";
import { deleteAccount } from "#/sharing/deleteAccount.ts";
import type { NoteEvents } from "#/sharing/noteEvents.ts";
import type { StorageDriver } from "#/storage/types.ts";
import {
  accountPrefsUpdateSchema,
  authLocaleSchema,
  authMeDeleteSchema,
  authMeUpdateSchema,
} from "#/validation/schemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import type { Broadcaster } from "#/ws/broadcaster.ts";
import { registerAccountKeyRoutes } from "./accountKeys.ts";
import { requireConfirmation } from "./confirmation.ts";
import type { LoginAttempts } from "./local/loginAttempts.ts";
import type { SessionRevocations } from "./revocations.ts";
import type { AuthProviderRouter } from "./types.ts";
import { toAuthUser } from "./users.ts";

interface SharedAuthRoutesDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  /** Tells the account's other devices when its preferences change. */
  broadcaster?: Broadcaster;
  loginAttempts: LoginAttempts;
  revocations: SessionRevocations;
  /** For starting an account again or deleting it, either of which takes
   * its notes from everyone. */
  noteEvents: NoteEvents;
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

  router.get("/me", async (c) => {
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
      // A sign-in or reset link already sent went to the address this
      // replaces.
      await deps.storage.signInLinks.deleteByUser(userId);
      await deps.storage.passwordResets.deleteByUser(userId);
      const body: AuthMeResponse = {
        user: toAuthUser({ ...user, email }),
      };
      return c.json(body);
    },
  );

  /**
   * Deletes the signed-in user's account, as an admin's delete does: its
   * notes go from everyone they were shared with, and its sessions end. With
   * the password, since a stolen session must not be able to erase the
   * account (`requireConfirmation`), and from a session only. The last admin
   * is refused (`409`), as everywhere else.
   */
  router.delete(
    "/me",
    zValidator("json", authMeDeleteSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      await requireConfirmation(deps, auth, c.req.valid("json").password);
      const result = await deleteAccount(deps, auth.userId);
      if (result === "not-found") throw new HttpError(401, "User not found");
      if (result === "last-admin") {
        throw new HttpError(409, "The server must keep at least one admin");
      }
      logger.info("A user deleted their account", { userId: auth.userId });
      audit(deps.storage, c, {
        action: "auth.account_deleted",
        actorId: auth.userId,
        targetId: auth.userId,
      });
      return c.body(null, 204);
    },
  );

  /**
   * The signed-in user's own lines of the audit log: their sign-ins and
   * failed ones, changes to how the account is secured, shares, and anything
   * an admin did to the account, downloading its notes included. What an admin
   * can see about someone, that person can see too. A session only, like the
   * other pages about how the account is secured.
   */
  router.get("/me/activity", async (c) => {
    const { userId } = c.get("auth");
    const body: AuditLogResponse = await auditPage(
      deps.storage,
      { limit: c.req.query("limit"), before: c.req.query("before") },
      userId,
    );
    return c.json(body);
  });

  /**
   * The account's preferences, so hidden tags and the rest follow it from
   * device to device. The server keeps what clients send and reads none of
   * it; each client parses what it gets back. Any credential, since a
   * preference changes nothing about how the account is secured.
   */
  router.get("/me/prefs", async (c) => {
    const { userId } = c.get("auth");
    const body: SealedAccountPrefsResponse = {
      prefs: (await deps.storage.prefs.get(userId)) as SealedAccountPrefs,
    };
    return c.json(body);
  });

  /** Merges in the keys given, `null` removing one; `413` past the limit. */
  router.patch(
    "/me/prefs",
    zValidator("json", accountPrefsUpdateSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const merged = await deps.storage.prefs.merge(
        userId,
        c.req.valid("json").prefs,
        nowIso(),
        MAX_SEALED_ACCOUNT_PREFS_BYTES,
      );
      if (merged === "tooLarge") {
        throw new HttpError(413, "Preferences are too large");
      }
      // Every socket of the account hears it, the sender's included; it
      // adopts what it already has, which changes nothing.
      const prefs = merged as SealedAccountPrefs;
      deps.broadcaster?.emit(userId, { type: "prefs:updated", prefs });
      const body: SealedAccountPrefsResponse = { prefs };
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

  registerAccountKeyRoutes(router, deps);

  return router;
}
