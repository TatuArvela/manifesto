import { zValidator } from "@hono/zod-validator";
import type {
  AccountKeysResponse,
  AuthSuccessResponse,
  RecoveryOpenResponse,
} from "@manifesto/shared";
import type { Context, Hono } from "hono";
import { audit } from "../audit/audit.js";
import type { ServerConfig } from "../config.js";
import { hashPassword } from "../lib/password.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import { hashToken, safeEqual } from "../lib/token.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type {
  StorageDriver,
  StoredAccountKeys,
  User,
} from "../storage/types.js";
import {
  accountKeysSetupSchema,
  keysConfirmSchema,
  recoveryCompleteSchema,
  recoveryKeyReplaceSchema,
  recoveryOpenSchema,
  recoverySignInCompleteSchema,
  recoverySignInOpenSchema,
  secretKeyReplaceSchema,
} from "../validation/schemas.js";
import { validatorHook } from "../validation/zValidator.js";
import { requireConfirmation } from "./confirmation.js";
import type { LoginAttempts } from "./local/loginAttempts.js";
import type { SessionRevocations } from "./revocations.js";
import { endUserSessions, issueSession } from "./session.js";
import { toAuthUser } from "./users.js";

// The keys an account's notes are encrypted with
// (`docs/specification/features/encryption.md`). Everything here is wrapped
// in the browser before it arrives: the server stores it, hands it back to
// the account's own sessions, and can open none of it. The one thing it
// checks is the recovery key, by a value derived from it whose hash it holds.

/** The first account key an account has; replacing every key raises it. */
const FIRST_KEY_VERSION = 1;

interface KeyRoutesDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  loginAttempts: LoginAttempts;
  revocations: SessionRevocations;
}

type AuthRouter = Hono<{ Variables: { auth: AuthContext } }>;

function tooManyAttempts(c: Context, wait: number): HttpError {
  c.header("Retry-After", String(wait));
  return new HttpError(429, "Too many attempts; try again later");
}

/**
 * The keys of `user`, if `verifier` is what their recovery key derives.
 * Guessing is throttled like a sign-in, on the same budget per name, and a
 * wrong one is counted and audited here so that neither way of using the key
 * can forget to. `status` is 401 where nobody is signed in and 403 where
 * someone is, since a client takes a 401 to mean its session ended.
 */
async function recoveryKeysOf(
  deps: KeyRoutesDeps,
  c: Context,
  username: string,
  user: User | null,
  verifier: string,
  status: 401 | 403,
): Promise<StoredAccountKeys> {
  const wait = deps.loginAttempts.retryAfter(username);
  if (wait > 0) throw tooManyAttempts(c, wait);
  const stored = user ? await deps.storage.accountKeys.get(user.id) : null;
  // Compared even when there is nothing to compare with, so that a name
  // nobody holds and an account without keys answer like a wrong key.
  const matches = safeEqual(
    stored?.recoveryVerifierHash ?? "",
    hashToken(verifier),
  );
  if (!stored || !matches) {
    deps.loginAttempts.fail(username);
    audit(deps.storage, c, {
      action: "auth.sign_in_failed",
      targetId: user?.id ?? null,
      detail: { username, reason: "recovery_key" },
    });
    throw new HttpError(
      status,
      "That recovery key is not right",
      "recovery_key_invalid",
    );
  }
  return stored;
}

function recoveryOpened(user: User, stored: StoredAccountKeys) {
  const body: RecoveryOpenResponse = {
    userId: user.id,
    version: stored.version,
    wrappedByRecovery: stored.wrappedByRecovery,
    hasPassword: user.passwordHash !== null,
  };
  return body;
}

/**
 * `/api/auth/keys`: an account's keys, for its own sessions. Session-only
 * throughout: a token is handed the keys it needs when it is made, never
 * these.
 */
export function registerAccountKeyRoutes(
  router: AuthRouter,
  deps: KeyRoutesDeps,
): void {
  const { storage, cfg } = deps;

  router.get("/keys", async (c) => {
    const { userId, signedInAt } = c.get("auth");
    const stored = await storage.accountKeys.get(userId);
    const signedIn = signedInAt ? new Date(signedInAt) : new Date();
    const body: AccountKeysResponse = {
      keys: stored && {
        version: stored.version,
        wrappedBySecret: stored.wrappedBySecret,
        publicKeys: {
          exchange: stored.exchangePublicKey,
          signing: stored.signingPublicKey,
        },
        wrappedPrivateKeys: {
          exchange: stored.wrappedExchangePrivateKey,
          signing: stored.wrappedSigningPrivateKey,
        },
      },
      sessionEndsAt: isoPlusDays(cfg.sessionAbsoluteTtlDays, signedIn),
    };
    return c.json(body);
  });

  /** An account's first keys. Refused once it has some: whichever device
   * set up first is the one whose sheet is right. */
  router.put(
    "/keys",
    zValidator("json", accountKeysSetupSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const input = c.req.valid("json");
      const now = nowIso();
      const created = await storage.accountKeys.create({
        userId,
        version: FIRST_KEY_VERSION,
        wrappedBySecret: input.wrappedBySecret,
        wrappedByRecovery: input.wrappedByRecovery,
        recoveryVerifierHash: hashToken(input.recoveryVerifier),
        exchangePublicKey: input.publicKeys.exchange,
        signingPublicKey: input.publicKeys.signing,
        wrappedExchangePrivateKey: input.wrappedPrivateKeys.exchange,
        wrappedSigningPrivateKey: input.wrappedPrivateKeys.signing,
        createdAt: now,
        updatedAt: now,
      });
      if (!created) {
        throw new HttpError(409, "This account already has its keys");
      }
      audit(storage, c, { action: "keys.created", actorId: userId });
      return c.body(null, 204);
    },
  );

  /**
   * Proof that the person at the session is the account's owner, before the
   * client shows the secret key it holds. The key never comes from here; this
   * only keeps a session left open from being enough to read it off a screen.
   */
  router.post(
    "/keys/confirm",
    zValidator("json", keysConfirmSchema, validatorHook),
    async (c) => {
      await requireConfirmation(
        deps,
        c.get("auth"),
        c.req.valid("json").password,
      );
      return c.body(null, 204);
    },
  );

  /** A new secret key: the same account key under a new wrap. Every other
   * device is signed out, and asks for the new key when it signs in. */
  router.post(
    "/keys/secret",
    zValidator("json", secretKeyReplaceSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      const { password, wrappedBySecret } = c.req.valid("json");
      await requireConfirmation(deps, auth, password);
      const replaced = await storage.accountKeys.setSecretWrap(
        auth.userId,
        wrappedBySecret,
        nowIso(),
      );
      if (!replaced) throw new HttpError(409, "This account has no keys yet");
      await endUserSessions(
        storage,
        deps.revocations,
        auth.userId,
        auth.token,
        { keepApiTokens: true },
      );
      audit(storage, c, {
        action: "keys.secret_key_replaced",
        actorId: auth.userId,
      });
      return c.body(null, 204);
    },
  );

  /** A new recovery key; the one before stops working. */
  router.post(
    "/keys/recovery",
    zValidator("json", recoveryKeyReplaceSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      const { password, wrappedByRecovery, recoveryVerifier } =
        c.req.valid("json");
      await requireConfirmation(deps, auth, password);
      const replaced = await storage.accountKeys.setRecovery(
        auth.userId,
        wrappedByRecovery,
        hashToken(recoveryVerifier),
        nowIso(),
      );
      if (!replaced) throw new HttpError(409, "This account has no keys yet");
      audit(storage, c, {
        action: "keys.recovery_key_replaced",
        actorId: auth.userId,
      });
      return c.body(null, 204);
    },
  );

  /**
   * Starts the account again, for someone who has lost the secret key on
   * every device and the recovery key too: the keys go, and the next thing
   * the client does is set up new ones. Nothing under the old keys can be
   * read again, by anyone. The account's other sessions end, since what they
   * hold opens nothing now.
   */
  router.delete(
    "/keys",
    zValidator("json", keysConfirmSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      await requireConfirmation(deps, auth, c.req.valid("json").password);
      if (!(await storage.accountKeys.delete(auth.userId))) {
        throw new HttpError(409, "This account has no keys yet");
      }
      await endUserSessions(storage, deps.revocations, auth.userId, auth.token);
      audit(storage, c, { action: "keys.started_again", actorId: auth.userId });
      return c.body(null, 204);
    },
  );

  /**
   * Using the recovery key while signed in, for someone who can still sign
   * in (through single sign-on, or with a password) and has lost the secret
   * key. Two steps: this one hands over the account key as the recovery key
   * wraps it, and `complete` puts a new secret key and a new recovery key in
   * place of the ones used.
   */
  router.post(
    "/keys/recover",
    zValidator("json", recoveryOpenSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const user = await storage.users.findById(userId);
      if (!user) throw new HttpError(401, "User not found");
      const stored = await recoveryKeysOf(
        deps,
        c,
        user.username,
        user,
        c.req.valid("json").verifier,
        403,
      );
      return c.json(recoveryOpened(user, stored));
    },
  );

  router.post(
    "/keys/recover/complete",
    zValidator("json", recoveryCompleteSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      const input = c.req.valid("json");
      const user = await storage.users.findById(auth.userId);
      if (!user) throw new HttpError(401, "User not found");
      const stored = await recoveryKeysOf(
        deps,
        c,
        user.username,
        user,
        input.verifier,
        403,
      );
      await spendRecoveryKey(deps, user, stored, input);
      await endUserSessions(storage, deps.revocations, user.id, auth.token);
      audit(storage, c, {
        action: "keys.recovery_key_used",
        actorId: user.id,
      });
      return c.body(null, 204);
    },
  );
}

/** Puts the new secret key and recovery key in place of the ones a recovery
 * used, once: of two requests holding the same key, one goes on. */
async function spendRecoveryKey(
  deps: KeyRoutesDeps,
  user: User,
  stored: StoredAccountKeys,
  next: {
    wrappedBySecret: string;
    wrappedByRecovery: string;
    recoveryVerifier: string;
  },
): Promise<void> {
  const replaced = await deps.storage.accountKeys.replaceUserKeys(
    user.id,
    stored.recoveryVerifierHash,
    {
      wrappedBySecret: next.wrappedBySecret,
      wrappedByRecovery: next.wrappedByRecovery,
      recoveryVerifierHash: hashToken(next.recoveryVerifier),
    },
    nowIso(),
  );
  if (!replaced) {
    throw new HttpError(409, "That recovery key was used a moment ago");
  }
  deps.loginAttempts.succeed(user.username);
}

/**
 * `/api/auth/recovery`: signing in with the recovery key and the username,
 * for a local account that has lost everything else (the password, the
 * authenticator, the passkeys). The same two steps as above, with nobody
 * signed in: the second chooses a new password and answers with a session.
 * An account that signs in through an identity provider signs in there and
 * uses the key afterwards, so it is refused here like a wrong key.
 */
export function registerRecoverySignInRoutes(
  router: AuthRouter,
  deps: KeyRoutesDeps,
): void {
  const { storage } = deps;

  const localUser = async (username: string): Promise<User | null> => {
    const user = await storage.users.findByUsername(username);
    return user && user.passwordHash !== null ? user : null;
  };

  router.post(
    "/recovery",
    zValidator("json", recoverySignInOpenSchema, validatorHook),
    async (c) => {
      const { username, verifier } = c.req.valid("json");
      const user = await localUser(username);
      const stored = await recoveryKeysOf(
        deps,
        c,
        username,
        user,
        verifier,
        401,
      );
      // `stored` is only ever returned for a user that exists.
      if (!user) throw new HttpError(401, "That recovery key is not right");
      return c.json(recoveryOpened(user, stored));
    },
  );

  router.post(
    "/recovery/complete",
    zValidator("json", recoverySignInCompleteSchema, validatorHook),
    async (c) => {
      const input = c.req.valid("json");
      const user = await localUser(input.username);
      const stored = await recoveryKeysOf(
        deps,
        c,
        input.username,
        user,
        input.verifier,
        401,
      );
      if (!user) throw new HttpError(401, "That recovery key is not right");
      await spendRecoveryKey(deps, user, stored, input);
      await storage.users.setPassword(
        user.id,
        await hashPassword(input.newPassword, deps.cfg),
        false,
      );
      // Whoever else was signed in, or held a token, held it on what was
      // lost.
      await endUserSessions(storage, deps.revocations, user.id);
      const { token } = await issueSession(storage, deps.cfg, user.id);
      audit(storage, c, {
        action: "keys.recovery_key_used",
        actorId: user.id,
      });
      audit(storage, c, {
        action: "auth.signed_in",
        actorId: user.id,
        detail: { method: "recovery_key" },
      });
      const body: AuthSuccessResponse = { token, user: toAuthUser(user) };
      return c.json(body);
    },
  );
}
