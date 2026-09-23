import { randomBytes } from "node:crypto";
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
import { emailTaken, HttpError } from "../../middleware/error.js";
import { rateLimit } from "../../middleware/rateLimit.js";
import type { StorageDriver } from "../../storage/types.js";
import { EmailTakenError } from "../../storage/types.js";
import {
  loginSchema,
  passwordChangeSchema,
  registerSchema,
} from "../../validation/schemas.js";
import { validatorHook } from "../../validation/zValidator.js";
import type { SessionRevocations } from "../revocations.js";
import { endUserSessions, issueSession, revokeSession } from "../session.js";
import type { AuthProvider, AuthProviderRouter } from "../types.js";
import { pickAvatarColor, toAuthUser } from "../users.js";
import { createLoginAttempts } from "./loginAttempts.js";

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

  // A budget per account on top of the budget per address, since an attacker
  // who can move between addresses gets a fresh one of the latter with each.
  const loginAttempts = createLoginAttempts();

  // A sign-in for a name nobody holds has to cost what a real one costs, or
  // the time the answer takes reports whether the account exists. Built from
  // the configured argon2 parameters, so it tracks an ARGON2_* override
  // rather than freezing one cost, and from a random string, so no password
  // ever verifies against it. Built on the first miss rather than at boot,
  // and held afterwards, since it never needs to differ.
  let decoyHash: Promise<string> | null = null;
  const spendDecoyVerify = async (password: string): Promise<void> => {
    try {
      decoyHash ??= hashPassword(randomBytes(32).toString("hex"), deps.cfg);
      await verifyPassword(await decoyHash, password);
    } catch {
      // The decoy buys time; it decides nothing. A failure to build one must
      // not turn an ordinary wrong name into a 500, now or on every later
      // miss that would have reused the rejected promise.
      decoyHash = null;
    }
  };

  auth.post(
    "/register",
    authThrottle,
    zValidator("json", registerSchema, validatorHook),
    async (c) => {
      if (!deps.cfg.registrationEnabled) {
        throw new HttpError(403, "Registration is disabled");
      }
      const { username, password, email } = c.req.valid("json");
      const existing = await deps.storage.users.findByUsername(username);
      if (existing) {
        throw new HttpError(409, "Username is already taken");
      }
      if (email && (await deps.storage.users.findByEmail(email))) {
        throw emailTaken();
      }
      const passwordHash = await hashPassword(password, deps.cfg);
      let user: Awaited<ReturnType<typeof deps.storage.users.create>>;
      try {
        user = await deps.storage.users.create({
          id: newId(),
          username,
          displayName: username,
          avatarColor: pickAvatarColor(),
          email: email ?? null,
          provider: "local",
          externalId: null,
          passwordHash,
          createdAt: nowIso(),
        });
      } catch (err) {
        if (err instanceof EmailTakenError) throw emailTaken();
        throw err;
      }
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
      const wait = loginAttempts.retryAfter(username);
      if (wait > 0) {
        // Ahead of the lookup and the verify, so a guessing run that has used
        // its budget stops costing the server argon2 as well.
        c.header("Retry-After", String(wait));
        throw new HttpError(429, "Too many sign-in attempts");
      }
      const user = await deps.storage.users.findByUsername(username);
      if (!user || user.passwordHash === null) {
        await spendDecoyVerify(password);
        loginAttempts.fail(username);
        throw new HttpError(401, "Invalid username or password");
      }
      const ok = await verifyPassword(user.passwordHash, password);
      if (!ok) {
        loginAttempts.fail(username);
        throw new HttpError(401, "Invalid username or password");
      }
      loginAttempts.succeed(username);
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
    createAuthMiddleware(deps.authProvider, { sessionOnly: true }),
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
