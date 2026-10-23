import { zValidator } from "@hono/zod-validator";
import type { DeviceLinkResponse } from "@manifesto/shared";
import type { Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import { requireConfirmation } from "#/auth/confirmation.ts";
import type { ServerConfig } from "#/config.ts";
import { hashToken, newSessionToken } from "#/lib/token.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import type { StorageDriver, User } from "#/storage/types.ts";
import {
  deviceLinkConfirmSchema,
  deviceLinkRequestSchema,
} from "#/validation/accountSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import type { LoginAttempts } from "./loginAttempts.ts";
import { type SecondFactorCheck, signInWithLink } from "./signInLink.ts";

/**
 * How long a QR code works. It is shorter than a mailed link. The person holds
 * both devices, and other persons can see a code on a screen.
 */
export const DEVICE_LINK_MINUTES = 5;

/** A temporary password gives no session. Thus, it cannot make a code. */
const opensByDevice = (user: User) => !user.mustChangePassword;

/**
 * `/api/v1/auth/device-link`: a signed-in device signs in a second device. The
 * first device confirms with the password (`requireConfirmation`), because a
 * stolen session must not make a session of its own that stays after it. It
 * gets a one-time token, and shows it as a QR code. The second device spends
 * the token through `signInWithLink`, the same path as a mailed link. Thus, an
 * account with a second factor still gives it on the second device.
 *
 * The token opens the account until it expires or is used. Thus,
 * `endUserSessions` cancels the tokens of the account with its sessions.
 */
export function registerDeviceLinkRoutes(
  auth: Hono<{ Variables: { auth: AuthContext } }>,
  deps: {
    storage: StorageDriver;
    cfg: ServerConfig;
    loginAttempts: LoginAttempts;
    secondFactor: SecondFactorCheck;
  },
) {
  const { storage } = deps;

  auth.post(
    "/device-link",
    zValidator("json", deviceLinkRequestSchema, validatorHook),
    async (c) => {
      const session = c.get("auth");
      await requireConfirmation(deps, session, c.req.valid("json").password);
      const token = newSessionToken();
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + DEVICE_LINK_MINUTES * 60_000,
      ).toISOString();
      await storage.deviceLinks.create({
        tokenHash: hashToken(token),
        userId: session.userId,
        createdAt: now.toISOString(),
        expiresAt,
      });
      audit(storage, c, {
        action: "auth.device_link_created",
        actorId: session.userId,
      });
      const body: DeviceLinkResponse = { token, expiresAt };
      return c.json(body, 200);
    },
  );

  auth.post(
    "/device-link/confirm",
    zValidator("json", deviceLinkConfirmSchema, validatorHook),
    (c) =>
      signInWithLink(c, deps, c.req.valid("json"), {
        links: storage.deviceLinks,
        opens: opensByDevice,
        method: "device",
      }),
  );
}
