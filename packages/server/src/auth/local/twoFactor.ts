import { zValidator } from "@hono/zod-validator";
import type {
  TwoFactorRecoveryCodesResponse,
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
} from "@manifesto/shared";
import type { Hono } from "hono";
import { verifyPassword } from "../../lib/password.js";
import { nowIso } from "../../lib/time.js";
import { hashToken } from "../../lib/token.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "../../middleware/authBearer.js";
import { HttpError } from "../../middleware/error.js";
import type { StorageDriver } from "../../storage/types.js";
import {
  twoFactorEnableSchema,
  twoFactorPasswordSchema,
} from "../../validation/schemas.js";
import { validatorHook } from "../../validation/zValidator.js";
import {
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  verifyTotp,
} from "../totp.js";
import type { AuthProvider } from "../types.js";

/**
 * Checks a second factor at sign-in: an authenticator code, each step usable
 * once, or an unused recovery code, each usable once. True if it passes.
 */
export async function checkSecondFactor(
  storage: StorageDriver,
  userId: string,
  secret: string,
  otp: string,
): Promise<boolean> {
  const step = verifyTotp(secret, otp, Date.now());
  if (step !== null) return storage.twoFactor.advanceStep(userId, step);
  return storage.twoFactor.useRecoveryCode(
    userId,
    hashToken(normalizeRecoveryCode(otp)),
    nowIso(),
  );
}

async function issueRecoveryCodes(
  storage: StorageDriver,
  userId: string,
): Promise<string[]> {
  const codes = newRecoveryCodes();
  await storage.twoFactor.replaceRecoveryCodes(
    userId,
    codes.map((code) => hashToken(code)),
  );
  return codes;
}

/**
 * `/api/auth/two-factor`: turning TOTP on and off for a local account. Every
 * step is session-only, and the ones that weaken or replace it ask for the
 * password again.
 */
export function registerTwoFactorRoutes(
  auth: Hono<{ Variables: { auth: AuthContext } }>,
  deps: {
    storage: StorageDriver;
    authProvider: AuthProvider;
    throttle: Parameters<Hono["use"]>[1];
  },
) {
  const { storage } = deps;
  const session = createAuthMiddleware(deps.authProvider, {
    sessionOnly: true,
  });

  async function requirePassword(userId: string, password: string) {
    const user = await storage.users.findById(userId);
    if (!user?.passwordHash) throw new HttpError(401, "User not found");
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new HttpError(403, "The password is not right");
    }
  }

  auth.get("/two-factor", session, async (c) => {
    const { userId } = c.get("auth");
    const state = await storage.twoFactor.get(userId);
    const enabled = state?.enabledAt != null;
    const body: TwoFactorStatusResponse = {
      enabled,
      recoveryCodesRemaining: enabled
        ? await storage.twoFactor.remainingRecoveryCodes(userId)
        : 0,
    };
    return c.json(body);
  });

  auth.post(
    "/two-factor/setup",
    deps.throttle,
    session,
    zValidator("json", twoFactorPasswordSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      await requirePassword(userId, c.req.valid("json").password);
      const secret = newTotpSecret();
      if (!(await storage.twoFactor.begin(userId, secret, nowIso()))) {
        throw new HttpError(409, "Two-factor sign-in is already on");
      }
      const body: TwoFactorSetupResponse = { secret };
      return c.json(body);
    },
  );

  auth.post(
    "/two-factor/enable",
    deps.throttle,
    session,
    zValidator("json", twoFactorEnableSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      const state = await storage.twoFactor.get(userId);
      if (!state || state.enabledAt !== null) {
        throw new HttpError(409, "Start the setup first");
      }
      const step = verifyTotp(
        state.secret,
        c.req.valid("json").code,
        Date.now(),
      );
      if (step === null) {
        throw new HttpError(
          422,
          "code: That code is not right",
          "two_factor_invalid",
        );
      }
      await storage.twoFactor.enable(userId, nowIso(), step);
      const body: TwoFactorRecoveryCodesResponse = {
        recoveryCodes: await issueRecoveryCodes(storage, userId),
      };
      return c.json(body);
    },
  );

  auth.post(
    "/two-factor/disable",
    deps.throttle,
    session,
    zValidator("json", twoFactorPasswordSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      await requirePassword(userId, c.req.valid("json").password);
      await storage.twoFactor.disable(userId);
      return c.body(null, 204);
    },
  );

  auth.post(
    "/two-factor/recovery-codes",
    deps.throttle,
    session,
    zValidator("json", twoFactorPasswordSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      await requirePassword(userId, c.req.valid("json").password);
      const state = await storage.twoFactor.get(userId);
      if (state?.enabledAt == null) {
        throw new HttpError(409, "Two-factor sign-in is off");
      }
      const body: TwoFactorRecoveryCodesResponse = {
        recoveryCodes: await issueRecoveryCodes(storage, userId),
      };
      return c.json(body);
    },
  );
}
