import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import type { ServerConfig } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { hashPassword } from "../../lib/password.js";
import { nowIso } from "../../lib/time.js";
import { hashToken, newSessionToken } from "../../lib/token.js";
import type { Mailer } from "../../mail/mailer.js";
import { mailLocale, passwordResetMail } from "../../mail/templates.js";
import type { AuthContext } from "../../middleware/authBearer.js";
import { HttpError } from "../../middleware/error.js";
import type { StorageDriver } from "../../storage/types.js";
import {
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from "../../validation/schemas.js";
import { validatorHook } from "../../validation/zValidator.js";
import type { SessionRevocations } from "../revocations.js";
import { endUserSessions } from "../session.js";

/** How long a link works. */
export const RESET_LINK_MINUTES = 30;
/** The least time between two links for one account, so the address cannot
 * be used to flood someone's inbox. */
const RESET_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * `/api/auth/password-reset`: a link by mail, for a local account whose
 * owner has forgotten the password. Only on a server with `SMTP_URL`; without
 * it an admin's temporary password is the way back in.
 *
 * Asking always answers 204, whether or not the address belongs to anyone,
 * and the mail goes out after the answer, so neither the answer nor its
 * timing says which addresses have accounts. Using the link ends every
 * session and API token of the account, as a password change does.
 * Two-factor sign-in stays on: the link proves control of the mailbox, not of
 * the authenticator.
 */
export function registerPasswordResetRoutes(
  auth: Hono<{ Variables: { auth: AuthContext } }>,
  deps: {
    storage: StorageDriver;
    cfg: ServerConfig;
    revocations: SessionRevocations;
    mailer: Mailer | null;
    throttle: Parameters<Hono["use"]>[1];
  },
) {
  const { storage, mailer } = deps;
  const appUrl = deps.cfg.mail?.appUrl;

  const requireMail = () => {
    if (!mailer || !appUrl) {
      throw new HttpError(404, "Password reset by mail is not set up");
    }
    return { mailer, appUrl };
  };

  async function sendLink(email: string, locale: string | undefined) {
    const { mailer, appUrl } = requireMail();
    const user = await storage.users.findByEmail(email);
    if (!user || user.passwordHash === null) return;
    const latest = await storage.passwordResets.latestFor(user.id);
    if (latest && Date.now() - Date.parse(latest) < RESET_COOLDOWN_MS) return;
    const token = newSessionToken();
    const now = new Date();
    await storage.passwordResets.create({
      tokenHash: hashToken(token),
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + RESET_LINK_MINUTES * 60_000,
      ).toISOString(),
    });
    const message = passwordResetMail(mailLocale(locale), {
      username: user.username,
      link: `${appUrl}/#reset=${token}`,
      minutes: RESET_LINK_MINUTES,
    });
    await mailer.send({ to: email, ...message });
  }

  auth.post(
    "/password-reset",
    deps.throttle,
    zValidator("json", passwordResetRequestSchema, validatorHook),
    async (c) => {
      requireMail();
      const { email, locale } = c.req.valid("json");
      void sendLink(email, locale).catch((err) => {
        logger.warn("Password reset link could not be made", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return c.body(null, 204);
    },
  );

  auth.post(
    "/password-reset/confirm",
    deps.throttle,
    zValidator("json", passwordResetConfirmSchema, validatorHook),
    async (c) => {
      requireMail();
      const { token, newPassword } = c.req.valid("json");
      const userId = await storage.passwordResets.consume(
        hashToken(token),
        nowIso(),
      );
      if (!userId) {
        throw new HttpError(410, "This link has expired or was used already");
      }
      await storage.users.setPassword(
        userId,
        await hashPassword(newPassword, deps.cfg),
        false,
      );
      await endUserSessions(storage, deps.revocations, userId);
      return c.body(null, 204);
    },
  );
}
