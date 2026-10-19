import { zValidator } from "@hono/zod-validator";
import {
  type AccountKeysResponse,
  type AuthSuccessResponse,
  MAX_SEEN_KEYS,
  type RecoveryOpenResponse,
  type SeenKeysResponse,
} from "@manifesto/shared";
import type { Context, Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import type { ServerConfig } from "#/config.ts";
import { hashPassword } from "#/lib/password.ts";
import { isoPlusDays, nowIso } from "#/lib/time.ts";
import { hashToken, safeEqual } from "#/lib/token.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import { emptyAccount } from "#/sharing/emptyAccount.ts";
import type { NoteEvents } from "#/sharing/noteEvents.ts";
import type {
  StorageDriver,
  StoredAccountKeys,
  User,
} from "#/storage/types.ts";
import {
  accountKeysSetupSchema,
  keysConfirmSchema,
  recoveryCompleteSchema,
  recoveryKeyReplaceSchema,
  recoveryOpenSchema,
  recoverySignInCompleteSchema,
  recoverySignInOpenSchema,
  secretKeyReplaceSchema,
} from "#/validation/accountSchemas.ts";
import { seenKeySchema } from "#/validation/sharingSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import { requireConfirmation } from "./confirmation.ts";
import type { LoginAttempts } from "./local/loginAttempts.ts";
import type { SessionRevocations } from "./revocations.ts";
import { endUserSessions, issueSession } from "./session.ts";
import { toAuthUser } from "./users.ts";

// The keys with which the notes of an account are encrypted
// (`docs/specification/features/encryption.md`). The browser wraps all of this
// before it arrives. The server stores it, gives it back to the own sessions of
// the account, and can open none of it. It checks only the recovery key, with a
// value derived from it whose hash it keeps.

/**
 * The first account key of an account. A replacement of all keys makes it
 * higher.
 */
const FIRST_KEY_VERSION = 1;

interface RecoveryDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  loginAttempts: LoginAttempts;
  revocations: SessionRevocations;
}

interface KeyRoutesDeps extends RecoveryDeps {
  /** For a new start of an account, which takes its notes from all persons. */
  noteEvents: NoteEvents;
}

type AuthRouter = Hono<{ Variables: { auth: AuthContext } }>;

function tooManyAttempts(c: Context, wait: number): HttpError {
  c.header("Retry-After", String(wait));
  return new HttpError(429, "Too many attempts; try again later");
}

/**
 * The keys of `user`, if `verifier` is what their recovery key derives. Guesses
 * have the same throttle as a sign-in, on the same budget for each name. This
 * function counts and audits a wrong key. Thus, neither way to use the key can
 * forget to do it. `status` is 401 where nobody is signed in, and 403 where a
 * person is, because a client reads a 401 as the end of its session.
 */
async function recoveryKeysOf(
  deps: RecoveryDeps,
  c: Context,
  username: string,
  user: User | null,
  verifier: string,
  status: 401 | 403,
): Promise<StoredAccountKeys> {
  const wait = deps.loginAttempts.retryAfter(username);
  if (wait > 0) throw tooManyAttempts(c, wait);
  const stored = user ? await deps.storage.accountKeys.get(user.id) : null;
  // The comparison occurs also when there is nothing to compare with. Thus, a
  // name that no account has and an account without keys answer as a wrong key.
  const matches = safeEqual(
    stored?.recoveryVerifierHash ?? "",
    hashToken(verifier),
  );
  if (!stored || !matches) {
    deps.loginAttempts.fail(username);
    audit(deps.storage, c, {
      action: "auth.sign_in_failed",
      targetId: user?.id ?? null,
      // Only the own name of an account. A name that no account has is
      // frequently a password typed into the wrong field (as at `/login`).
      detail: {
        ...(user && { username: user.username }),
        reason: "recovery_key",
      },
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
 * `/api/v1/auth/keys`: the keys of an account, for its own sessions. All routes
 * are session-only. A token gets the keys that it needs when it is made, never
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

  /**
   * The first keys of an account. The server refuses them when the account
   * already has keys. The sheet of the device that did the setup first is the
   * correct sheet.
   */
  // What the account remembers of the public keys of other people. It is sealed
  // under its own key. Thus, the server keeps the list, and can read none of
  // it. The server could remove an entry, and a client then sees that person
  // for the first time again.
  router.get("/keys/seen", async (c) => {
    const { userId } = c.get("auth");
    const body: SeenKeysResponse = {
      seen: await storage.accountKeys.seenKeys(userId),
    };
    return c.json(body);
  });

  router.put(
    "/keys/seen/:userId",
    zValidator("json", seenKeySchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const peerId = c.req.param("userId");
      if (peerId.length > 64) throw new HttpError(404, "User not found");
      const kept = await storage.accountKeys.rememberKey(
        userId,
        peerId,
        c.req.valid("json").sealed,
        nowIso(),
        MAX_SEEN_KEYS,
      );
      if (!kept) throw new HttpError(409, "Too many remembered keys");
      return c.body(null, 204);
    },
  );

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
   * Proof that the person at the session is the owner of the account, before
   * the client shows the secret key that it has. The key never comes from here.
   * This only prevents a person from reading it off the screen of a session
   * that stays open.
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

  /**
   * A new secret key: the same account key under a new wrap. All other devices
   * are signed out, and ask for the new key when they sign in.
   */
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

  /** A new recovery key. The previous one stops. */
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
   * Starts the account again, for a person who lost the secret key on all
   * devices and also the recovery key. The keys go, and all data sealed under
   * them goes too (`emptyAccount`), because nobody can read it again. The next
   * action of the client is to set up new keys. The other sessions and the
   * tokens of the account end, because what they have opens nothing now.
   *
   * The keys go last. The emptying is many writes, with no transaction. If one
   * write fails, the account still has its keys, and the client can send the
   * same request again. If the keys went first, the server would refuse that
   * request, and the remaining data would stay sealed under keys that nobody
   * has. The other sessions end first, so that none of them writes a note in
   * the meantime.
   */
  router.delete(
    "/keys",
    zValidator("json", keysConfirmSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      await requireConfirmation(deps, auth, c.req.valid("json").password);
      if (!(await storage.accountKeys.get(auth.userId))) {
        throw new HttpError(409, "This account has no keys yet");
      }
      await endUserSessions(storage, deps.revocations, auth.userId, auth.token);
      await emptyAccount(deps, auth.userId);
      await storage.accountKeys.delete(auth.userId);
      audit(storage, c, { action: "keys.started_again", actorId: auth.userId });
      return c.body(null, 204);
    },
  );

  /**
   * Use of the recovery key while signed in, for a person who can still sign in
   * (through single sign-on, or with a password) and lost the secret key. There
   * are two steps. This step gives the account key as the recovery key wraps
   * it. `complete` puts a new secret key and a new recovery key in place of the
   * used keys.
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

/**
 * Puts the new secret key and recovery key in place of the keys that a recovery
 * used, one time. If two requests have the same key, only one continues.
 */
async function spendRecoveryKey(
  deps: RecoveryDeps,
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
 * `/api/v1/auth/recovery`: a sign-in with the recovery key and the username,
 * for a local account that lost all else (the password, the authenticator, the
 * passkeys). These are the same two steps as above, with nobody signed in. The
 * second step selects a new password, and answers with a session. An account
 * that signs in through an identity provider signs in there and uses the key
 * after that. Thus, the server refuses it here, as a wrong key.
 */
export function registerRecoverySignInRoutes(
  router: AuthRouter,
  deps: RecoveryDeps,
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
      // `stored` is only returned for a user that exists.
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
      // All other persons who were signed in, or had a token, had it on what
      // was lost.
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
