import { zValidator } from "@hono/zod-validator";
import type {
  TwoFactorRecoveryCodesResponse,
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
} from "@manifesto/shared";
import type { Hono } from "hono";
import { audit } from "../../audit/audit.js";
import { nowIso } from "../../lib/time.js";
import { hashToken } from "../../lib/token.js";
import type { AuthContext } from "../../middleware/authBearer.js";
import { HttpError } from "../../middleware/error.js";
import type { StorageDriver } from "../../storage/types.js";
import {
  twoFactorEnableSchema,
  twoFactorPasswordSchema,
} from "../../validation/schemas.js";
import { validatorHook } from "../../validation/zValidator.js";
import { requireConfirmation } from "../confirmation.js";
import {
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  verifyTotp,
} from "../totp.js";
import type { LoginAttempts } from "./loginAttempts.js";

/**
 * Checks a typed second factor at sign-in: an authenticator code, each step
 * usable once, or an unused recovery code, each usable once. `secret` is null
 * for an account whose second factor is passkeys alone, where only a recovery
 * code can be typed. True if it passes.
 */
export async function checkSecondFactor(
  storage: StorageDriver,
  userId: string,
  secret: string | null,
  otp: string,
): Promise<boolean> {
  const step = secret === null ? null : verifyTotp(secret, otp, Date.now());
  if (step !== null) return storage.twoFactor.advanceStep(userId, step);
  return storage.twoFactor.useRecoveryCode(
    userId,
    hashToken(normalizeRecoveryCode(otp)),
    nowIso(),
  );
}

/** Whether the account has a second factor: an authenticator, a passkey, or
 * both. The recovery codes stand in for whichever it has. */
export async function hasSecondFactor(
  storage: StorageDriver,
  userId: string,
): Promise<boolean> {
  const totp = await storage.twoFactor.get(userId);
  if (totp?.enabledAt != null) return true;
  return (await storage.passkeys.listByUser(userId)).length > 0;
}

export async function issueRecoveryCodes(
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
    loginAttempts: LoginAttempts;
  },
) {
  const { storage } = deps;

  const confirmation = { storage, loginAttempts: deps.loginAttempts };

  auth.get("/two-factor", async (c) => {
    const { userId } = c.get("auth");
    const state = await storage.twoFactor.get(userId);
    const authenticator = state?.enabledAt != null;
    const enabled =
      authenticator || (await storage.passkeys.listByUser(userId)).length > 0;
    const body: TwoFactorStatusResponse = {
      enabled,
      authenticator,
      recoveryCodesRemaining: enabled
        ? await storage.twoFactor.remainingRecoveryCodes(userId)
        : 0,
    };
    return c.json(body);
  });

  auth.post(
    "/two-factor/setup",
    zValidator("json", twoFactorPasswordSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      await requireConfirmation(
        confirmation,
        c.get("auth"),
        c.req.valid("json").password,
      );
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
      // Codes come with the first second factor; passkeys already added
      // have them, and they cover the authenticator too.
      const first = !(await hasSecondFactor(storage, userId));
      await storage.twoFactor.enable(userId, nowIso(), step);
      audit(storage, c, { action: "auth.two_factor_enabled", actorId: userId });
      const body: TwoFactorRecoveryCodesResponse = {
        recoveryCodes: first ? await issueRecoveryCodes(storage, userId) : [],
      };
      return c.json(body);
    },
  );

  auth.post(
    "/two-factor/disable",
    zValidator("json", twoFactorPasswordSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      await requireConfirmation(
        confirmation,
        c.get("auth"),
        c.req.valid("json").password,
      );
      // Passkeys left behind keep the codes, which stand in for them too.
      if ((await storage.passkeys.listByUser(userId)).length > 0) {
        await storage.twoFactor.removeAuthenticator(userId);
      } else {
        await storage.twoFactor.disable(userId);
      }
      audit(storage, c, {
        action: "auth.two_factor_disabled",
        actorId: userId,
      });
      return c.body(null, 204);
    },
  );

  auth.post(
    "/two-factor/recovery-codes",
    zValidator("json", twoFactorPasswordSchema, validatorHook),
    async (c) => {
      const { userId } = c.get("auth");
      await requireConfirmation(
        confirmation,
        c.get("auth"),
        c.req.valid("json").password,
      );
      if (!(await hasSecondFactor(storage, userId))) {
        throw new HttpError(409, "Two-factor sign-in is off");
      }
      const body: TwoFactorRecoveryCodesResponse = {
        recoveryCodes: await issueRecoveryCodes(storage, userId),
      };
      return c.json(body);
    },
  );
}
