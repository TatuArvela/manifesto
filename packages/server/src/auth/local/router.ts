import { randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import type { AuthSuccessResponse } from "@manifesto/shared";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import { registerRecoverySignInRoutes } from "#/auth/accountKeys.ts";
import type { SessionRevocations } from "#/auth/revocations.ts";
import {
  endUserSessions,
  issueSession,
  revokeSession,
} from "#/auth/session.ts";
import type { AuthProviderRouter } from "#/auth/types.ts";
import { pickAvatarColor, toAuthUser } from "#/auth/users.ts";
import type { ServerConfig } from "#/config.ts";
import { hashPassword, verifyPassword } from "#/lib/password.ts";
import { nowIso } from "#/lib/time.ts";
import { newId } from "#/lib/ulid.ts";
import type { Mailer } from "#/mail/mailer.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { emailTaken, HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { EmailTakenError } from "#/storage/types.ts";
import {
  loginSchema,
  passwordChangeSchema,
  registerSchema,
} from "#/validation/accountSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import { createLoginAttempts, type LoginAttempts } from "./loginAttempts.ts";
import {
  createPasskeyChallenges,
  createPasskeySecondFactor,
  registerPasskeyRoutes,
} from "./passkeys.ts";
import { registerPasswordResetRoutes } from "./passwordReset.ts";
import {
  registerSignInLinkRoutes,
  type SecondFactorCheck,
} from "./signInLink.ts";
import { checkSecondFactor, registerTwoFactorRoutes } from "./twoFactor.ts";

interface LocalRouterDeps {
  storage: StorageDriver;
  cfg: ServerConfig;
  revocations: SessionRevocations;
  /** Null when the server sends no mail. Then there is no reset by mail. */
  mailer?: Mailer | null;
  /**
   * Shared with the confirmation of actions. Its own instance when not given.
   */
  loginAttempts?: LoginAttempts;
}

export function createLocalAuthRouter(
  deps: LocalRouterDeps,
): AuthProviderRouter {
  const auth = new Hono<{ Variables: { auth: AuthContext } }>();

  // A budget for each account in addition to the budget for each address. An
  // attacker who can move between addresses gets a new budget of the second
  // type with each address.
  const loginAttempts = deps.loginAttempts ?? createLoginAttempts();
  const passkeyChallenges = createPasskeyChallenges();
  const passkeySecondFactor = createPasskeySecondFactor({
    storage: deps.storage,
    cfg: deps.cfg,
    challenges: passkeyChallenges,
  });

  // A sign-in for a name that no account has must cost the same as a real
  // sign-in. If not, the duration of the answer tells if the account exists.
  // The code builds it from the configured argon2 parameters, so that it
  // follows an ARGON2_* override and does not use one fixed cost. It builds it
  // from a random string, so that no password ever passes against it. It builds
  // it on the first miss, not at start, and keeps it after that, because it
  // never needs to change.
  let decoyHash: Promise<string> | null = null;
  const spendDecoyVerify = async (password: string): Promise<void> => {
    try {
      decoyHash ??= hashPassword(randomBytes(32).toString("hex"), deps.cfg);
      await verifyPassword(await decoyHash, password);
    } catch {
      // The decoy only uses time. It decides nothing. If the code cannot build
      // one, an ordinary wrong name must not become a 500, now or on each later
      // miss that would use the rejected promise again.
      decoyHash = null;
    }
  };

  /**
   * The second factor of a sign-in whose first step (the password, or a mailed
   * link) passed. It answers with the challenge to send back when the account
   * has one and the request brought none. If not, it answers with the factor
   * that passed. It refuses a wrong factor here, and counts and audits it.
   * Thus, no way to sign in can forget either step.
   */
  const secondFactor: SecondFactorCheck = async (c, user, otp, passkey) => {
    const userId = user.id;
    const totp = await deps.storage.twoFactor.get(userId);
    const authenticator = totp?.enabledAt != null;
    const passkeys = await deps.storage.passkeys.listByUser(userId);
    if (!authenticator && passkeys.length === 0) {
      return { with: null };
    }
    if (otp === undefined && passkey === undefined) {
      // The factors that exist, and a challenge for the passkeys. Thus, the
      // client can offer each one without another round of the first step.
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
    if (!passed) {
      loginAttempts.fail(user.username);
      audit(deps.storage, c, {
        action: "auth.sign_in_failed",
        targetId: userId,
        detail: { username: user.username, reason: "two_factor" },
      });
      throw new HttpError(401, "That code is not right", "two_factor_invalid");
    }
    return { with: otp !== undefined ? "yes" : "passkey" };
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
        // Before the lookup and the verify. Thus, a series of guesses that used
        // its budget also stops to cost the server argon2.
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
          // The server does not keep a name that no account has. It is
          // frequently a password typed into the wrong field, or the address of
          // a different person.
          detail: {
            ...(user && { username: user.username }),
            reason: "unknown_account",
          },
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
      // The second factor, after the password, so that the question for it
      // tells a wrong guess nothing. It uses the same budget for each account.
      // Thus, nobody can try all six-digit codes.
      const second = await secondFactor(c, user, otp, passkey);
      if ("challenge" in second) return c.json(second.challenge, 403);
      loginAttempts.succeed(username);
      // A temporary password gives only the right to set a real password. No
      // session exists until it is replaced. Thus, there is no half-signed-in
      // state that all other routes must refuse. The check is after the
      // password. Thus, a wrong guess never learns about the flag.
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
    // The same throttle as for sign-in. A session is sufficient to guess the
    // current password here, and a stolen session must not make that easy.
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
      // The same budget for each account as for sign-in and for the
      // confirmation of an action. A stolen session can move between addresses
      // to fill the address bucket again.
      const wait = loginAttempts.retryAfter(user.username);
      if (wait > 0) {
        c.header("Retry-After", String(wait));
        throw new HttpError(429, "Too many wrong passwords; try again later");
      }
      // 403, not 401. The session is correct, and a client reads 401 as a
      // sign-out.
      if (!(await verifyPassword(user.passwordHash, currentPassword))) {
        loginAttempts.fail(user.username);
        throw new HttpError(403, "Current password is incorrect");
      }
      loginAttempts.succeed(user.username);
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
      // A password change is how a person locks out a person who learned the
      // password. Thus, all other sessions end, and this session continues.
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
  registerRecoverySignInRoutes(auth, {
    storage: deps.storage,
    cfg: deps.cfg,
    revocations: deps.revocations,
    loginAttempts,
  });

  return auth;
}
