import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import type { SessionRevocations } from "#/auth/revocations.ts";
import { endUserSessions } from "#/auth/session.ts";
import type { ServerConfig } from "#/config.ts";
import { hashPassword } from "#/lib/password.ts";
import { nowIso } from "#/lib/time.ts";
import { hashToken } from "#/lib/token.ts";
import type { Mailer } from "#/mail/mailer.ts";
import { passwordResetMail } from "#/mail/templates.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
import {
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from "#/validation/accountSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import { mailedLinks } from "./mailedLink.ts";

/** How long a link works. */
export const RESET_LINK_MINUTES = 30;

/**
 * `/api/auth/password-reset`: a link by mail, for a local account whose
 * owner has forgotten the password. Only on a server with `SMTP_URL`; without
 * it an admin's temporary password is the way back in.
 *
 * Asking is `mailedLinks`, shared with sign-in by mail: always 204, whether
 * or not the address belongs to anyone, with the mail after the answer. Using the link ends every
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
  },
) {
  const { storage } = deps;
  const link = mailedLinks(deps, {
    links: storage.passwordResets,
    fragment: "reset",
    minutes: RESET_LINK_MINUTES,
    eligible: (user) => user.passwordHash !== null,
    mail: passwordResetMail,
    requested: "auth.password_reset_requested",
    notSetUp: "Password reset by mail is not set up",
  });

  auth.post(
    "/password-reset",
    zValidator("json", passwordResetRequestSchema, validatorHook),
    (c) => {
      link.requireMail();
      const { email, locale } = c.req.valid("json");
      link.send(email, locale, c);
      return c.body(null, 204);
    },
  );

  auth.post(
    "/password-reset/confirm",
    zValidator("json", passwordResetConfirmSchema, validatorHook),
    async (c) => {
      link.requireMail();
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
      audit(storage, c, { action: "auth.password_reset", actorId: userId });
      return c.body(null, 204);
    },
  );
}
