import { zValidator } from "@hono/zod-validator";
import type {
  AuthSuccessResponse,
  TwoFactorRequiredResponse,
} from "@manifesto/shared";
import type { Context, Hono } from "hono";
import { audit } from "#/audit/audit.ts";
import { issueSession } from "#/auth/session.ts";
import { toAuthUser } from "#/auth/users.ts";
import type { ServerConfig } from "#/config.ts";
import { nowIso } from "#/lib/time.ts";
import { hashToken } from "#/lib/token.ts";
import type { Mailer } from "#/mail/mailer.ts";
import { signInLinkMail } from "#/mail/templates.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver, User } from "#/storage/types.ts";
import {
  signInLinkConfirmSchema,
  signInLinkRequestSchema,
} from "#/validation/accountSchemas.ts";
import { validatorHook } from "#/validation/zValidator.ts";
import type { LoginAttempts } from "./loginAttempts.ts";
import { mailedLinks } from "./mailedLink.ts";

/**
 * How long a link works. It is shorter than a reset link, because it is a way
 * in by itself. A reset still leaves a password to select.
 */
export const SIGN_IN_LINK_MINUTES = 15;

/**
 * What `router.ts` uses to check a second factor, shared with the password. It
 * answers with the challenge to send back, or with the factor that passed (null
 * for an account that has none). A wrong answer never comes back. The code
 * counts it against the account, audits it, and throws it as the 401.
 */
export type SecondFactorCheck = (
  c: Context,
  user: { id: string; username: string },
  otp: string | undefined,
  passkey: unknown,
) => Promise<
  { challenge: TwoFactorRequiredResponse } | { with: "yes" | "passkey" | null }
>;

/**
 * No link for an account that signs in elsewhere (no password here), or that
 * has a temporary password that its owner did not replace yet.
 */
const opensByLink = (user: User) =>
  user.passwordHash !== null && !user.mustChangePassword;

/**
 * `/api/v1/auth/sign-in-link`: a sign-in to a local account from a link sent to
 * its address, with no password typed. Only on a server with `SMTP_URL`.
 * `MAGIC_LINKS` switches it.
 *
 * The request is `mailedLinks`, shared with reset by mail: always 204, whether
 * the address belongs to an account or not, with the mail after the answer. The
 * server makes no link for an account that signs in elsewhere (no password
 * here), or that still has a temporary password. The person who got that
 * password must replace it before anything else opens the account.
 *
 * The link replaces the password, and nothing else. An account with a second
 * factor must give it, on the same budget for each account as a password
 * sign-in. A wrong answer keeps the link good. Thus, the person can answer the
 * challenge again with the link from the mail.
 *
 * A link does not stay valid after a change to what it replaces, or to where it
 * was sent. `endUserSessions` and both email changes cancel the links of the
 * account.
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
  const { storage, loginAttempts } = deps;
  const link = mailedLinks(deps, {
    links: storage.signInLinks,
    fragment: "signin",
    minutes: SIGN_IN_LINK_MINUTES,
    eligible: opensByLink,
    mail: signInLinkMail,
    requested: "auth.sign_in_link_requested",
    notSetUp: "Sign-in by mail is not set up",
  });

  auth.post(
    "/sign-in-link",
    zValidator("json", signInLinkRequestSchema, validatorHook),
    (c) => {
      link.requireMail();
      const { email, locale } = c.req.valid("json");
      link.send(email, locale, c);
      return c.body(null, 204);
    },
  );

  auth.post(
    "/sign-in-link/confirm",
    zValidator("json", signInLinkConfirmSchema, validatorHook),
    async (c) => {
      link.requireMail();
      const { token, otp, passkey } = c.req.valid("json");
      const tokenHash = hashToken(token);
      const gone = () =>
        new HttpError(410, "This link has expired or was used already");
      const userId = await storage.signInLinks.find(tokenHash, nowIso());
      const user = userId ? await storage.users.findById(userId) : null;
      // Made before the account lost its password or got a temporary password.
      // The link does not open it now.
      if (!user || !opensByLink(user)) throw gone();
      // The budget protects what a person can guess, which here is only the
      // second factor. An account without one does not use the budget. All
      // persons can use up the budget with wrong passwords, and the link is
      // then the way in for its owner.
      const refuseIfLocked = () => {
        const wait = loginAttempts.retryAfter(user.username);
        if (wait > 0) {
          c.header("Retry-After", String(wait));
          throw new HttpError(429, "Too many sign-in attempts");
        }
      };
      // An answer to the second factor uses the link before the code looks at
      // the answer, atomically. If two requests have the same link, one
      // continues. A link that expired in the meantime costs no code. A wrong
      // answer gives the link back.
      const answering = otp !== undefined || passkey !== undefined;
      const spend = async () => {
        if ((await storage.signInLinks.consume(tokenHash, nowIso())) === null) {
          throw gone();
        }
      };
      if (answering) {
        refuseIfLocked();
        await spend();
      }
      // The code in there refuses a wrong answer, and counts and audits its
      // attempt. Here, the code only gives the link back.
      const second = await deps
        .secondFactor(c, user, otp, passkey)
        .catch(async (err: unknown) => {
          if (answering) await storage.signInLinks.release(tokenHash);
          throw err;
        });
      if ("challenge" in second) {
        refuseIfLocked();
        return c.json(second.challenge, 403);
      }
      if (!answering) await spend();
      // Only a second factor that passed clears the count. A link alone proves
      // nothing about who guessed at the password.
      if (second.with !== null) loginAttempts.succeed(user.username);
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
