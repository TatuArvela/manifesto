import { zValidator } from "@hono/zod-validator";
import type {
  AuthSuccessResponse,
  PasskeyAddedResponse,
  PasskeyCreationOptions,
  PasskeyOptionsResponse,
  PasskeyRequestOptions,
  PasskeySignInOptionsResponse,
  PasskeysResponse,
} from "@manifesto/shared";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { Context, Hono } from "hono";
import { audit } from "../../audit/audit.js";
import type { ServerConfig } from "../../config.js";
import { publicOrigin } from "../../lib/origin.js";
import { nowIso } from "../../lib/time.js";
import { newId } from "../../lib/ulid.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../../middleware/authBearer.js";
import { HttpError } from "../../middleware/error.js";
import { listedPasskey } from "../../storage/passkeyMapping.js";
import type { StorageDriver, StoredPasskey } from "../../storage/types.js";
import {
  passkeyAddSchema,
  passkeyLoginSchema,
  twoFactorPasswordSchema,
} from "../../validation/schemas.js";
import { validatorHook } from "../../validation/zValidator.js";
import { requireConfirmation } from "../confirmation.js";
import { issueSession } from "../session.js";
import type { AuthProvider } from "../types.js";
import { toAuthUser } from "../users.js";
import type { LoginAttempts } from "./loginAttempts.js";
import { hasSecondFactor, issueRecoveryCodes } from "./twoFactor.js";

/** Enough for every device and key a person owns, and a bound on a script. */
export const MAX_PASSKEYS_PER_USER = 20;

/** How long a challenge can be answered. The browser's own prompt gives up
 * sooner, at the `timeout` in the options. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Challenges held at once. Asking for one needs no account, so this is what
 * bounds the map; past it, the oldest go first. */
const MAX_CHALLENGES = 10_000;

type Purpose = "register" | "second-factor" | "sign-in";

interface PendingChallenge {
  purpose: Purpose;
  /** Whose ceremony it is; null for a sign-in, where nobody is known yet. */
  userId: string | null;
  origin: string;
  expiresAt: number;
}

/**
 * The challenges handed out and not yet answered. Each is good once, for the
 * purpose, account and page it was issued to, until it expires. Every entry
 * lives equally long, so insertion order is expiry order: the sweep stops at
 * the first live one, and an eviction takes the one closest to expiring.
 */
export function createPasskeyChallenges(now: () => number = Date.now) {
  const pending = new Map<string, PendingChallenge>();

  function sweep(at: number) {
    for (const [challenge, entry] of pending) {
      if (entry.expiresAt > at) break;
      pending.delete(challenge);
    }
  }

  return {
    issue(challenge: string, entry: Omit<PendingChallenge, "expiresAt">): void {
      const at = now();
      sweep(at);
      pending.set(challenge, { ...entry, expiresAt: at + CHALLENGE_TTL_MS });
      if (pending.size > MAX_CHALLENGES) {
        const oldest = pending.keys().next().value;
        if (oldest !== undefined) pending.delete(oldest);
      }
    },
    /** Spends a challenge; true only if it was issued for exactly this. */
    take(
      challenge: string,
      purpose: Purpose,
      userId: string | null,
      origin: string,
    ): boolean {
      const entry = pending.get(challenge);
      if (!entry) return false;
      pending.delete(challenge);
      return (
        entry.purpose === purpose &&
        entry.userId === userId &&
        entry.origin === origin &&
        entry.expiresAt > now()
      );
    },
  };
}

export type PasskeyChallenges = ReturnType<typeof createPasskeyChallenges>;

type CeremonyConfig = Pick<
  ServerConfig,
  "corsOrigins" | "appUrl" | "trustProxy"
>;

/**
 * Where a passkey is being used: the origin of the page asking, which has to
 * be one this server's client is served from (`CORS_ORIGINS`, `APP_URL`, or
 * this server itself), and the host that is its relying party ID. A passkey
 * belongs to that host, so one made on one address does not work on another.
 */
function ceremonyOf(
  c: Context,
  cfg: CeremonyConfig,
): { origin: string; rpId: string } {
  const origin = c.req.header("Origin");
  const allowed = new Set(cfg.corsOrigins);
  if (cfg.appUrl) allowed.add(new URL(cfg.appUrl).origin);
  allowed.add(publicOrigin(c, cfg.trustProxy));
  if (!origin || !allowed.has(origin)) {
    throw new HttpError(400, "Passkeys work only from this server's client");
  }
  return { origin, rpId: new URL(origin).hostname };
}

const descriptor = (passkey: StoredPasskey) => ({
  id: passkey.credentialId,
  transports: passkey.transports,
});

/** Checks a passkey's answer against the stored key, and records the use.
 * The library throws for a malformed answer, which is a failure like any. */
async function verifyAssertion(
  storage: StorageDriver,
  passkey: StoredPasskey,
  response: AuthenticationResponseJSON,
  expected: {
    take: (challenge: string) => boolean;
    origin: string;
    rpId: string;
    userVerification: boolean;
  },
): Promise<boolean> {
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: expected.take,
      expectedOrigin: expected.origin,
      expectedRPID: expected.rpId,
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, "base64url"),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: expected.userVerification,
    });
    if (!result.verified) return false;
    await storage.passkeys.recordUse(
      passkey.id,
      result.authenticationInfo.newCounter,
      nowIso(),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The passkey half of the second factor at sign-in: a challenge for the
 * account's passkeys on this address, and the check of the answer.
 */
export function createPasskeySecondFactor(deps: {
  storage: StorageDriver;
  cfg: CeremonyConfig;
  challenges: PasskeyChallenges;
}) {
  return {
    /** Null when none of the account's passkeys belongs to this address, or
     * the request did not come from a page that could use one. */
    async options(
      c: Context,
      userId: string,
      passkeys: StoredPasskey[],
    ): Promise<PasskeyRequestOptions | null> {
      let ceremony: { origin: string; rpId: string };
      try {
        ceremony = ceremonyOf(c, deps.cfg);
      } catch {
        return null;
      }
      const usable = passkeys.filter((p) => p.rpId === ceremony.rpId);
      if (usable.length === 0) return null;
      const options = await generateAuthenticationOptions({
        rpID: ceremony.rpId,
        allowCredentials: usable.map(descriptor),
        userVerification: "preferred",
      });
      deps.challenges.issue(options.challenge, {
        purpose: "second-factor",
        userId,
        origin: ceremony.origin,
      });
      return options as PasskeyRequestOptions;
    },
    async verify(
      c: Context,
      userId: string,
      passkeys: StoredPasskey[],
      response: AuthenticationResponseJSON,
    ): Promise<boolean> {
      let ceremony: { origin: string; rpId: string };
      try {
        ceremony = ceremonyOf(c, deps.cfg);
      } catch {
        return false;
      }
      const passkey = passkeys.find((p) => p.credentialId === response.id);
      if (!passkey || passkey.rpId !== ceremony.rpId) return false;
      return verifyAssertion(deps.storage, passkey, response, {
        take: (challenge) =>
          deps.challenges.take(
            challenge,
            "second-factor",
            userId,
            ceremony.origin,
          ),
        origin: ceremony.origin,
        rpId: ceremony.rpId,
        userVerification: false,
      });
    },
  };
}

/**
 * Passkeys for a local account: `/api/auth/passkeys` to list, add and remove
 * them (session only, the password asked again to add or remove one), and
 * `/api/auth/passkey/*` to sign in with one alone, with no name or password.
 * A passkey made here is discoverable (a resident key), so the browser can
 * offer it at sign-in without being told whose account it is.
 */
export function registerPasskeyRoutes(
  auth: Hono<{ Variables: { auth: AuthContext } }>,
  deps: {
    storage: StorageDriver;
    authProvider: AuthProvider;
    cfg: ServerConfig;
    challenges: PasskeyChallenges;
    throttle: Parameters<Hono["use"]>[1];
    /** Looser than the password one: a passkey cannot be guessed at, so this
     * bounds the challenges an address can have issued. */
    signInThrottle: Parameters<Hono["use"]>[1];
    loginAttempts: LoginAttempts;
  },
) {
  const { storage, challenges } = deps;
  const session = createAuthMiddleware(deps.authProvider, {
    sessionOnly: true,
  });
  const confirmation = { storage, loginAttempts: deps.loginAttempts };

  /** The signed-in local account, which has a password to confirm with. */
  async function localUser(userId: string) {
    const user = await storage.users.findById(userId);
    if (!user) throw new HttpError(401, "User not found");
    if (user.passwordHash === null) {
      throw new HttpError(
        409,
        "This account signs in through single sign-on, which keeps its own second factor",
      );
    }
    return user;
  }

  auth.get("/passkeys", session, async (c) => {
    const { userId } = c.get("auth");
    const body: PasskeysResponse = {
      passkeys: (await storage.passkeys.listByUser(userId)).map(listedPasskey),
    };
    return c.json(body);
  });

  auth.post(
    "/passkeys/options",
    deps.throttle,
    session,
    zValidator("json", twoFactorPasswordSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      const user = await localUser(auth.userId);
      // A passkey is a way into the account on its own, as a token is.
      await requireConfirmation(
        confirmation,
        auth,
        c.req.valid("json").password,
      );
      const ceremony = ceremonyOf(c, deps.cfg);
      const existing = await storage.passkeys.listByUser(user.id);
      if (existing.length >= MAX_PASSKEYS_PER_USER) {
        throw new HttpError(409, "Remove a passkey before adding another");
      }
      const options = await generateRegistrationOptions({
        rpName: ceremony.rpId,
        rpID: ceremony.rpId,
        userName: user.username,
        userDisplayName: user.displayName || user.username,
        userID: new TextEncoder().encode(user.id),
        attestationType: "none",
        // Its own on the device, so a sign-in can find it without a name.
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "preferred",
        },
        excludeCredentials: existing
          .filter((p) => p.rpId === ceremony.rpId)
          .map(descriptor),
      });
      challenges.issue(options.challenge, {
        purpose: "register",
        userId: user.id,
        origin: ceremony.origin,
      });
      const body: PasskeyOptionsResponse = {
        options: options as PasskeyCreationOptions,
      };
      return c.json(body);
    },
  );

  auth.post(
    "/passkeys",
    deps.throttle,
    session,
    zValidator("json", passkeyAddSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const user = await localUser(userId);
      const ceremony = ceremonyOf(c, deps.cfg);
      const { name, response } = c.req.valid("json");
      let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
      try {
        verification = await verifyRegistrationResponse({
          response: response as RegistrationResponseJSON,
          expectedChallenge: (challenge) =>
            challenges.take(challenge, "register", user.id, ceremony.origin),
          expectedOrigin: ceremony.origin,
          expectedRPID: ceremony.rpId,
          requireUserVerification: false,
        });
      } catch {
        throw new HttpError(422, "The passkey could not be verified");
      }
      if (!verification.verified) {
        throw new HttpError(422, "The passkey could not be verified");
      }
      const info = verification.registrationInfo;
      if (await storage.passkeys.findByCredentialId(info.credential.id)) {
        throw new HttpError(409, "That passkey is already added");
      }
      const first = !(await hasSecondFactor(storage, user.id));
      const passkey: StoredPasskey = {
        id: newId(),
        userId: user.id,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        rpId: ceremony.rpId,
        name: name || "Passkey",
        synced: info.credentialBackedUp,
        createdAt: nowIso(),
        lastUsedAt: null,
      };
      await storage.passkeys.create(passkey);
      audit(storage, c, {
        action: "auth.passkey_added",
        actorId: user.id,
        detail: { name: passkey.name },
      });
      // The first second factor turns two-factor on, and one set of recovery
      // codes covers every factor from then on.
      const body: PasskeyAddedResponse = {
        passkey: listedPasskey(passkey),
        recoveryCodes: first
          ? await issueRecoveryCodes(storage, user.id)
          : null,
      };
      return c.json(body, 201);
    },
  );

  auth.delete(
    "/passkeys/:id",
    deps.throttle,
    session,
    zValidator("json", twoFactorPasswordSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      await requireConfirmation(
        confirmation,
        auth,
        c.req.valid("json").password,
      );
      const id = c.req.param("id");
      if (!(await storage.passkeys.delete(id, auth.userId))) {
        throw new HttpError(404, "Passkey not found");
      }
      // The codes stand in for the factors; with none left there is nothing
      // for them to stand in for.
      if (!(await hasSecondFactor(storage, auth.userId))) {
        await storage.twoFactor.replaceRecoveryCodes(auth.userId, []);
      }
      audit(storage, c, {
        action: "auth.passkey_removed",
        actorId: auth.userId,
        detail: { id },
      });
      return c.body(null, 204);
    },
  );

  auth.post("/passkey/options", deps.signInThrottle, async (c) => {
    const ceremony = ceremonyOf(c, deps.cfg);
    const options = await generateAuthenticationOptions({
      rpID: ceremony.rpId,
      // Alone, the passkey is both factors: the device has to check that it
      // is its owner using it.
      userVerification: "required",
    });
    challenges.issue(options.challenge, {
      purpose: "sign-in",
      userId: null,
      origin: ceremony.origin,
    });
    const body: PasskeySignInOptionsResponse = {
      options: options as PasskeyRequestOptions,
    };
    return c.json(body);
  });

  auth.post(
    "/passkey/login",
    deps.signInThrottle,
    zValidator("json", passkeyLoginSchema, validatorHook),
    async (c) => {
      const ceremony = ceremonyOf(c, deps.cfg);
      const response = c.req.valid("json")
        .response as AuthenticationResponseJSON;
      const passkey = await storage.passkeys.findByCredentialId(response.id);
      const user = passkey
        ? await storage.users.findById(passkey.userId)
        : null;
      const refuse = () => {
        audit(storage, c, {
          action: "auth.sign_in_failed",
          targetId: user?.id ?? null,
          detail: { reason: "passkey" },
        });
        return new HttpError(401, "That passkey is not known here");
      };
      // A temporary password is to be replaced before anything else happens,
      // and an account without a password signs in through its provider.
      if (
        !passkey ||
        !user ||
        user.passwordHash === null ||
        user.mustChangePassword ||
        passkey.rpId !== ceremony.rpId
      ) {
        throw refuse();
      }
      const verified = await verifyAssertion(storage, passkey, response, {
        take: (challenge) =>
          challenges.take(challenge, "sign-in", null, ceremony.origin),
        origin: ceremony.origin,
        rpId: ceremony.rpId,
        userVerification: true,
      });
      if (!verified) throw refuse();
      const { token } = await issueSession(storage, deps.cfg, user.id);
      audit(storage, c, {
        action: "auth.signed_in",
        actorId: user.id,
        detail: { method: "passkey" },
      });
      const body: AuthSuccessResponse = { token, user: toAuthUser(user) };
      return c.json(body);
    },
  );
}
