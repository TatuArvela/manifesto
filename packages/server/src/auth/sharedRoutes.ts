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
} from "#/validation/accountSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import type { Broadcaster } from "#/ws/broadcaster.ts";
import { registerAccountKeyRoutes } from "./accountKeys.ts";
import { requireConfirmation } from "./confirmation.ts";
import { registerDeviceSignInRoutes } from "./deviceSignIn.ts";
import type { LoginAttempts } from "./local/loginAttempts.ts";
import type { SessionRevocations } from "./revocations.ts";
import type { AuthProviderRouter } from "./types.ts";
import { toAuthUser } from "./users.ts";

interface SharedAuthRoutesDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  /** Tells the other devices of the account when its preferences change. */
  broadcaster?: Broadcaster;
  loginAttempts: LoginAttempts;
  revocations: SessionRevocations;
  /**
   * For a new start of an account, or its deletion. Both take its notes from
   * all persons.
   */
  noteEvents: NoteEvents;
}

/**
 * Auth endpoints that do not depend on the provider. They mount together with
 * the router of the active provider. Thus, the client can find which login UI
 * to show, and get the current user again from a bearer token (after an OIDC
 * callback, when the client only gets a token in the URL fragment).
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
   * The own details of the signed-in user. Now, only the email address. An
   * account that signs in through an identity provider gets its address from
   * there at each sign-in. Thus, it cannot set one here (`409`).
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
      // A reset link goes to this address. Thus, the person who sets it can
      // take the password next.
      await requireConfirmation(deps, c.get("auth"), password);
      const result = await deps.storage.users.setEmail(userId, email);
      if (result === "not-found") throw new HttpError(401, "User not found");
      if (result === "email-taken") throw emailTaken();
      // A sign-in or reset link that was already sent went to the address that
      // this replaces.
      await deps.storage.signInLinks.deleteByUser(userId);
      await deps.storage.passwordResets.deleteByUser(userId);
      const body: AuthMeResponse = {
        user: toAuthUser({ ...user, email }),
      };
      return c.json(body);
    },
  );

  /**
   * Deletes the account of the signed-in user, as a delete by an admin does.
   * Its notes go out of the notes of all persons who shared them, and its
   * sessions end. It needs the password, because a stolen session must not be
   * able to delete the account (`requireConfirmation`), and only a session can
   * use it. The server refuses the last admin (`409`), as in all other places.
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
   * The own lines of the audit log of the signed-in user: their sign-ins and
   * failed sign-ins, changes to the security of the account, shares, and all
   * actions of an admin on the account, also a download of its notes. What an
   * admin can see about a person, that person can also see. Only a session, as
   * for the other pages about the security of the account.
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
   * The preferences of the account. Thus, hidden tags and the other preferences
   * go with it from device to device. The server keeps what clients send, and
   * reads none of it. Each client parses what it gets back. All credentials can
   * use it, because a preference changes nothing about the security of the
   * account.
   */
  router.get("/me/prefs", async (c) => {
    const { userId } = c.get("auth");
    const body: SealedAccountPrefsResponse = {
      prefs: (await deps.storage.prefs.get(userId)) as SealedAccountPrefs,
    };
    return c.json(body);
  });

  /** Merges the given keys. `null` removes one. `413` after the limit. */
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
      // All sockets of the account get it, also that of the sender. The sender
      // adopts what it already has, which changes nothing.
      const prefs = merged as SealedAccountPrefs;
      deps.broadcaster?.emit(userId, { type: "prefs:updated", prefs });
      const body: SealedAccountPrefsResponse = { prefs };
      return c.json(body);
    },
  );

  /**
   * The language of the client. Thus, mail that the action of a different
   * account sends to this account (a share invitation) is in it. The client
   * reports it when it is different from what `/me` said: on its first start,
   * and after the user changes it.
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
  registerDeviceSignInRoutes(router, deps);

  return router;
}
