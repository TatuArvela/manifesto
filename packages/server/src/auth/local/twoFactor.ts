import { zValidator } from "@hono/zod-validator";
import type {
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
} from "@manifesto/shared";
import type { Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import { requireConfirmation } from "#/auth/confirmation.ts";
import { newTotpSecret, verifyTotp } from "#/auth/totp.ts";
import { nowIso } from "#/lib/time.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
import {
  twoFactorEnableSchema,
  twoFactorPasswordSchema,
} from "#/validation/accountSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import type { LoginAttempts } from "./loginAttempts.ts";

/**
 * Checks a typed second factor at sign-in: an authenticator code, each step
 * usable once. `secret` is null for an account whose second factor is
 * passkeys alone, which has nothing to type: whoever lost those signs in
 * with the recovery key (`auth/accountKeys.ts`). True if it passes.
 */
export async function checkSecondFactor(
  storage: StorageDriver,
  userId: string,
  secret: string | null,
  otp: string,
): Promise<boolean> {
  const step = secret === null ? null : verifyTotp(secret, otp, Date.now());
  if (step === null) return false;
  return storage.twoFactor.advanceStep(userId, step);
}

/** Whether the account has a second factor: an authenticator, a passkey, or
 * both. */
export async function hasSecondFactor(
  storage: StorageDriver,
  userId: string,
): Promise<boolean> {
  const totp = await storage.twoFactor.get(userId);
  if (totp?.enabledAt != null) return true;
  return (await storage.passkeys.listByUser(userId)).length > 0;
}

/**
 * `/api/v1/auth/two-factor`: turning TOTP on and off for a local account. Every
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
    const body: TwoFactorStatusResponse = { enabled, authenticator };
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
      await storage.twoFactor.enable(userId, nowIso(), step);
      audit(storage, c, { action: "auth.two_factor_enabled", actorId: userId });
      return c.body(null, 204);
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
      await storage.twoFactor.disable(userId);
      audit(storage, c, {
        action: "auth.two_factor_disabled",
        actorId: userId,
      });
      return c.body(null, 204);
    },
  );
}
