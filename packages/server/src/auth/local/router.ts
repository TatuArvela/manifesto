import { randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import type { AuthSuccessResponse } from "@manifesto/shared";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { Hono } from "hono";
import { audit } from "../../audit/audit.js";
import type { ServerConfig } from "../../config.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { nowIso } from "../../lib/time.js";
import { newId } from "../../lib/ulid.js";
import type { Mailer } from "../../mail/mailer.js";
import type { AuthContext } from "../../middleware/authBearer.js";
import { emailTaken, HttpError } from "../../middleware/error.js";
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
import type { AuthProviderRouter } from "../types.js";
import { pickAvatarColor, toAuthUser } from "../users.js";
import { createLoginAttempts, type LoginAttempts } from "./loginAttempts.js";
import {
  createPasskeyChallenges,
  createPasskeySecondFactor,
  registerPasskeyRoutes,
} from "./passkeys.js";
import { registerPasswordResetRoutes } from "./passwordReset.js";
import {
  registerSignInLinkRoutes,
  type SecondFactorCheck,
} from "./signInLink.js";
import { checkSecondFactor, registerTwoFactorRoutes } from "./twoFactor.js";

interface LocalRouterDeps {
  storage: StorageDriver;
  cfg: ServerConfig;
  revocations: SessionRevocations;
  /** Null when the server sends no mail: then there is no reset by mail. */
  mailer?: Mailer | null;
  /** Shared with confirming actions; a router of its own when left out. */
  loginAttempts?: LoginAttempts;
}

export function createLocalAuthRouter(
  deps: LocalRouterDeps,
): AuthProviderRouter {
  const auth = new Hono<{ Variables: { auth: AuthContext } }>();

  // A budget per account on top of the budget per address, since an attacker
  // who can move between addresses gets a fresh one of the latter with each.
  const loginAttempts = deps.loginAttempts ?? createLoginAttempts();
  const passkeyChallenges = createPasskeyChallenges();
  const passkeySecondFactor = createPasskeySecondFactor({
    storage: deps.storage,
    cfg: deps.cfg,
    challenges: passkeyChallenges,
  });

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

  /**
   * The second factor of a sign-in whose first step (the password, or a
   * mailed link) has already held. Answers with the challenge to send back
   * when the account has one and the request brought none, and otherwise
   * with whether what it brought is right, and which factor it was.
   */
  const secondFactor: SecondFactorCheck = async (c, userId, otp, passkey) => {
    const totp = await deps.storage.twoFactor.get(userId);
    const authenticator = totp?.enabledAt != null;
    const passkeys = await deps.storage.passkeys.listByUser(userId);
    if (!authenticator && passkeys.length === 0) {
      return { passed: true, with: null };
    }
    if (otp === undefined && passkey === undefined) {
      // Which factors there are, and a challenge for the passkeys, so the
      // client can offer each without another round of the first step.
      return {
        challenge: {
          error: "Confirm with your second factor",
          code: "two_factor_required",
          twoFactor: {
            authenticator,
            passkey: await passkeySecondFactor.options(c, userId, passkeys),
          },
        },
      };
    }
    const passed =
      otp !== undefined
        ? await checkSecondFactor(
            deps.storage,
            userId,
            authenticator ? (totp?.secret ?? null) : null,
            otp,
          )
        : await passkeySecondFactor.verify(
            c,
            userId,
            passkeys,
            passkey as AuthenticationResponseJSON,
          );
    return passed
      ? { passed: true, with: otp !== undefined ? "yes" : "passkey" }
      : { passed: false };
  };

  auth.post(
    "/register",
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
      audit(deps.storage, c, {
        action: "account.registered",
        actorId: user.id,
      });
      const body: AuthSuccessResponse = { token, user: toAuthUser(user) };
      return c.json(body, 201);
    },
  );

  auth.post(
    "/login",
    zValidator("json", loginSchema, validatorHook),
    async (c) => {
      const { username, password, newPassword, otp, passkey } =
        c.req.valid("json");
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
        audit(deps.storage, c, {
          action: "auth.sign_in_failed",
          targetId: user?.id ?? null,
          detail: { username, reason: "unknown_account" },
        });
        throw new HttpError(401, "Invalid username or password");
      }
      const ok = await verifyPassword(user.passwordHash, password);
      if (!ok) {
        loginAttempts.fail(username);
        audit(deps.storage, c, {
          action: "auth.sign_in_failed",
          targetId: user.id,
          detail: { username, reason: "password" },
        });
        throw new HttpError(401, "Invalid username or password");
      }
      // The second factor, after the password so that asking for one tells a
      // wrong guess nothing, and on the same per-account budget, so six
      // digits cannot be walked through.
      const second = await secondFactor(c, user.id, otp, passkey);
      if ("challenge" in second) return c.json(second.challenge, 403);
      if (!second.passed) {
        loginAttempts.fail(username);
        audit(deps.storage, c, {
          action: "auth.sign_in_failed",
          targetId: user.id,
          detail: { username, reason: "two_factor" },
        });
        throw new HttpError(
          401,
          "That code is not right",
          "two_factor_invalid",
        );
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
      audit(deps.storage, c, {
        action: "auth.signed_in",
        actorId: user.id,
        detail: {
          method: "password",
          ...(second.with && { twoFactor: second.with }),
        },
      });
      const body: AuthSuccessResponse = { token, user: toAuthUser(user) };
      return c.json(body, 200);
    },
  );

  auth.post("/logout", async (c) => {
    const { token } = c.get("auth");
    await revokeSession(deps.storage, token);
    audit(deps.storage, c, {
      action: "auth.signed_out",
      actorId: c.get("auth").userId,
    });
    return c.body(null, 204);
  });

  auth.post(
    "/password",
    // Throttled like sign-in: a session is enough to guess at the current
    // password here, and a stolen one should not make that cheap.
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
      audit(deps.storage, c, {
        action: "auth.password_changed",
        actorId: userId,
      });
      return c.body(null, 204);
    },
  );

  registerPasswordResetRoutes(auth, {
    storage: deps.storage,
    cfg: deps.cfg,
    revocations: deps.revocations,
    mailer: deps.mailer ?? null,
  });
  registerSignInLinkRoutes(auth, {
    storage: deps.storage,
    cfg: deps.cfg,
    mailer: deps.mailer ?? null,
    loginAttempts,
    secondFactor,
  });
  registerTwoFactorRoutes(auth, {
    storage: deps.storage,
    loginAttempts,
  });
  registerPasskeyRoutes(auth, {
    storage: deps.storage,
    cfg: deps.cfg,
    challenges: passkeyChallenges,
    loginAttempts,
  });

  return auth;
}
