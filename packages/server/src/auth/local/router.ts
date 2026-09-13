import { zValidator } from "@hono/zod-validator";
import type { AuthSuccessResponse } from "@manifesto/shared";
import { Hono } from "hono";
import type { ServerConfig } from "../../config.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { nowIso } from "../../lib/time.js";
import { newId } from "../../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../../middleware/authBearer.js";
import { HttpError } from "../../middleware/error.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import type { StorageDriver } from "../../storage/types.js";
import {
  authCredentialsSchema,
  loginSchema,
  passwordChangeSchema,
} from "../../validation/schemas.js";
import { validatorHook } from "../../validation/zValidator.js";
import type { SessionRevocations } from "../revocations.js";
import { endUserSessions, issueSession, revokeSession } from "../session.js";
import type { AuthProvider, AuthProviderRouter } from "../types.js";
import { pickAvatarColor, toAuthUser } from "../users.js";

interface LocalRouterDeps {
  storage: StorageDriver;
  authProvider: AuthProvider;
  cfg: ServerConfig;
  revocations: SessionRevocations;
}

export function createLocalAuthRouter(
  deps: LocalRouterDeps,
): AuthProviderRouter {
  const auth = new Hono<{ Variables: { auth: AuthContext } }>();

  // Tight per-IP throttling on the unauthenticated endpoints slows down
  // password-spraying attacks. Production defaults are 10 requests / 15 minutes
  // per IP.
  const authThrottle = rateLimit({
    limit: 10,
    windowMs: 15 * 60 * 1000,
    trustProxy: deps.cfg.trustProxy,
  });

  auth.post(
    "/register",
    authThrottle,
    zValidator("json", authCredentialsSchema, validatorHook),
    async (c) => {
      if (!deps.cfg.registrationEnabled) {
        throw new HttpError(403, "Registration is disabled");
      }
      const { username, password } = c.req.valid("json");
      const existing = await deps.storage.users.findByUsername(username);
      if (existing) {
        throw new HttpError(409, "Username is already taken");
      }
      const passwordHash = await hashPassword(password, deps.cfg);
      const user = await deps.storage.users.create({
        id: newId(),
        username,
        displayName: username,
        avatarColor: pickAvatarColor(),
        provider: "local",
        externalId: null,
        passwordHash,
        createdAt: nowIso(),
      });
      const { token } = await issueSession(deps.storage, deps.cfg, user.id);
      const body: AuthSuccessResponse = { token, user: toAuthUser(user) };
      return c.json(body, 201);
    },
  );

  auth.post(
    "/login",
    authThrottle,
    zValidator("json", loginSchema, validatorHook),
    async (c) => {
      const { username, password, newPassword } = c.req.valid("json");
      const user = await deps.storage.users.findByUsername(username);
      if (!user || user.passwordHash === null) {
        throw new HttpError(401, "Invalid username or password");
      }
      const ok = await verifyPassword(user.passwordHash, password);
      if (!ok) {
        throw new HttpError(401, "Invalid username or password");
      }
      // A temporary password buys the right to set a real one and nothing
      // else: no session exists until it has been replaced, so there is no
      // half-signed-in state for every other route to have to refuse. Checked
      // after the password, so the flag is never disclosed to a wrong guess.
      if (user.mustChangePassword) {
        if (newPassword === undefined) {
          throw new HttpError(
            403,
            "Choose a new password to finish signing in",
            "password_change_required",
          );
        }
        if (newPassword === password) {
          throw new HttpError(
            422,
            "newPassword: The new password must differ from the temporary one",
          );
        }
        await deps.storage.users.setPassword(
          user.id,
          await hashPassword(newPassword, deps.cfg),
          false,
        );
      }
      const { token } = await issueSession(deps.storage, deps.cfg, user.id);
      const body: AuthSuccessResponse = { token, user: toAuthUser(user) };
      return c.json(body, 200);
    },
  );

  auth.post("/logout", createAuthMiddleware(deps.authProvider), async (c) => {
    const { token } = c.get("auth");
    await revokeSession(deps.storage, token);
    return c.body(null, 204);
  });

  auth.post(
    "/password",
    // Throttled like sign-in: a session is enough to guess at the current
    // password here, and a stolen one should not make that cheap.
    authThrottle,
    createAuthMiddleware(deps.authProvider),
    zValidator("json", passwordChangeSchema, validatorHook),
    async (c) => {
      const { userId, token } = c.get("auth");
      const { currentPassword, newPassword } = c.req.valid("json");
      const user = await deps.storage.users.findById(userId);
      if (!user) {
        throw new HttpError(401, "User not found");
      }
      if (user.passwordHash === null) {
        throw new HttpError(409, "This account signs in without a password");
      }
      // 403 rather than 401: the session is fine, and a client treats 401 as
      // being signed out.
      if (!(await verifyPassword(user.passwordHash, currentPassword))) {
        throw new HttpError(403, "Current password is incorrect");
      }
      if (newPassword === currentPassword) {
        throw new HttpError(
          422,
          "newPassword: The new password must differ from the current one",
        );
      }
      await deps.storage.users.setPassword(
        userId,
        await hashPassword(newPassword, deps.cfg),
        false,
      );
      // Changing a password is how someone locks out a person who learned it,
      // so every other session ends, and this one carries on.
      await endUserSessions(deps.storage, deps.revocations, userId, token);
      return c.body(null, 204);
    },
  );

  return auth;
}
