import { zValidator } from "@hono/zod-validator";
import type {
  AuthSuccessResponse,
  TwoFactorRequiredResponse,
} from "@manifesto/shared";
import type { Context, Hono } from "hono";
import { audit } from "../../audit/audit.js";
import type { ServerConfig } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { nowIso } from "../../lib/time.js";
import { hashToken, newSessionToken } from "../../lib/token.js";
import type { Mailer } from "../../mail/mailer.js";
import { mailLocale, signInLinkMail } from "../../mail/templates.js";
import type { AuthContext } from "../../middleware/authBearer.js";
import { HttpError } from "../../middleware/error.js";
import type { StorageDriver } from "../../storage/types.js";
import {
  signInLinkConfirmSchema,
  signInLinkRequestSchema,
} from "../../validation/schemas.js";
import { validatorHook } from "../../validation/zValidator.js";
import { issueSession } from "../session.js";
import { toAuthUser } from "../users.js";
import type { LoginAttempts } from "./loginAttempts.js";

/** How long a link works. Shorter than a reset link: it is a way in by
 * itself, where a reset still leaves a password to choose. */
export const SIGN_IN_LINK_MINUTES = 15;
/** The least time between two links for one account, so the address cannot
 * be used to flood someone's inbox. */
const LINK_COOLDOWN_MS = 5 * 60 * 1000;

/** What `router.ts` checks a second factor with, shared with the password. */
export type SecondFactorCheck = (
  c: Context,
  userId: string,
  otp: string | undefined,
  passkey: unknown,
) => Promise<
  | { challenge: TwoFactorRequiredResponse }
  | { passed: false }
  | { passed: true; with: "yes" | "passkey" | null }
>;

/**
 * `/api/auth/sign-in-link`: signing in to a local account from a link sent to
 * its address, with no password typed. Only on a server with `SMTP_URL`, and
 * switched by `MAGIC_LINKS`.
 *
 * Asking always answers 204, whether or not the address belongs to anyone,
 * and the mail goes out after the answer, as a password reset does it. No
 * link is made for an account that signs in elsewhere (no password here) or
 * that still holds a temporary password, which has to be replaced by the
 * person it was handed to before anything else opens the account.
 *
 * The link stands in for the password and for nothing else: an account with
 * a second factor is asked for it, on the same per-account budget as a
 * password sign-in, and the link is only spent once that has passed, so the
 * challenge can be answered with the link the mail brought.
 */
export function registerSignInLinkRoutes(
  auth: Hono<{ Variables: { auth: AuthContext } }>,
  deps: {
    storage: StorageDriver;
    cfg: ServerConfig;
    mailer: Mailer | null;
    loginAttempts: LoginAttempts;
    secondFactor: SecondFactorCheck;
  },
) {
  const { storage, mailer, loginAttempts } = deps;
  const appUrl = deps.cfg.mail?.appUrl;

  const requireMail = () => {
    if (!mailer || !appUrl) {
      throw new HttpError(404, "Sign-in by mail is not set up");
    }
    return { mailer, appUrl };
  };

  async function sendLink(
    email: string,
    locale: string | undefined,
    c: { req: { raw: Request } },
  ) {
    const { mailer, appUrl } = requireMail();
    const user = await storage.users.findByEmail(email);
    if (!user || user.passwordHash === null || user.mustChangePassword) return;
    const latest = await storage.signInLinks.latestFor(user.id);
    if (latest && Date.now() - Date.parse(latest) < LINK_COOLDOWN_MS) return;
    const token = newSessionToken();
    const now = new Date();
    await storage.signInLinks.create({
      tokenHash: hashToken(token),
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + SIGN_IN_LINK_MINUTES * 60_000,
      ).toISOString(),
    });
    const message = signInLinkMail(mailLocale(locale), {
      username: user.username,
      link: `${appUrl}/#signin=${token}`,
      minutes: SIGN_IN_LINK_MINUTES,
    });
    await mailer.send({ to: email, ...message });
    audit(storage, c, {
      action: "auth.sign_in_link_requested",
      targetId: user.id,
    });
  }

  auth.post(
    "/sign-in-link",
    zValidator("json", signInLinkRequestSchema, validatorHook),
    async (c) => {
      requireMail();
      const { email, locale } = c.req.valid("json");
      void sendLink(email, locale, c).catch((err) => {
        logger.warn("Sign-in link could not be made", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return c.body(null, 204);
    },
  );

  auth.post(
    "/sign-in-link/confirm",
    zValidator("json", signInLinkConfirmSchema, validatorHook),
    async (c) => {
      requireMail();
      const { token, otp, passkey } = c.req.valid("json");
      const tokenHash = hashToken(token);
      const gone = () =>
        new HttpError(410, "This link has expired or was used already");
      const userId = await storage.signInLinks.find(tokenHash, nowIso());
      const user = userId ? await storage.users.findById(userId) : null;
      // Made before the account lost its password or was handed a temporary
      // one: the link no longer opens it.
      if (!user || user.passwordHash === null || user.mustChangePassword) {
        throw gone();
      }
      const wait = loginAttempts.retryAfter(user.username);
      if (wait > 0) {
        c.header("Retry-After", String(wait));
        throw new HttpError(429, "Too many sign-in attempts");
      }
      const second = await deps.secondFactor(c, user.id, otp, passkey);
      if ("challenge" in second) return c.json(second.challenge, 403);
      if (!second.passed) {
        loginAttempts.fail(user.username);
        audit(storage, c, {
          action: "auth.sign_in_failed",
          targetId: user.id,
          detail: { username: user.username, reason: "two_factor" },
        });
        throw new HttpError(
          401,
          "That code is not right",
          "two_factor_invalid",
        );
      }
      // Spent only now, and atomically: of two requests holding the same
      // link, one gets a session.
      if ((await storage.signInLinks.consume(tokenHash, nowIso())) === null) {
        throw gone();
      }
      loginAttempts.succeed(user.username);
      const session = await issueSession(storage, deps.cfg, user.id);
      audit(storage, c, {
        action: "auth.signed_in",
        actorId: user.id,
        detail: {
          method: "link",
          ...(second.with && { twoFactor: second.with }),
        },
      });
      const body: AuthSuccessResponse = {
        token: session.token,
        user: toAuthUser(user),
      };
      return c.json(body, 200);
    },
  );
}
