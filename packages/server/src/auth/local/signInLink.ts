import { zValidator } from "@hono/zod-validator";
import type {
  AuthSuccessResponse,
  TwoFactorRequiredResponse,
} from "@manifesto/shared";
import type { Context, Hono } from "hono";
import { audit } from "../../audit/audit.js";
import type { ServerConfig } from "../../config.js";
import { nowIso } from "../../lib/time.js";
import { hashToken } from "../../lib/token.js";
import type { Mailer } from "../../mail/mailer.js";
import { signInLinkMail } from "../../mail/templates.js";
import type { AuthContext } from "../../middleware/authBearer.js";
import { HttpError } from "../../middleware/error.js";
import type { StorageDriver, User } from "../../storage/types.js";
import {
  signInLinkConfirmSchema,
  signInLinkRequestSchema,
} from "../../validation/schemas.js";
import { validatorHook } from "../../validation/zValidator.js";
import { issueSession } from "../session.js";
import { toAuthUser } from "../users.js";
import type { LoginAttempts } from "./loginAttempts.js";
import { mailedLinks } from "./mailedLink.js";

/** How long a link works. Shorter than a reset link: it is a way in by
 * itself, where a reset still leaves a password to choose. */
export const SIGN_IN_LINK_MINUTES = 15;

/**
 * What `router.ts` checks a second factor with, shared with the password.
 * It answers with the challenge to send back, or with the factor that held
 * (null for an account that has none). A wrong answer never comes back: it
 * is counted against the account, audited and thrown as the 401.
 */
export type SecondFactorCheck = (
  c: Context,
  user: { id: string; username: string },
  otp: string | undefined,
  passkey: unknown,
) => Promise<
  { challenge: TwoFactorRequiredResponse } | { with: "yes" | "passkey" | null }
>;

/** No link for an account that signs in elsewhere (no password here), or
 * that holds a temporary password its owner has yet to replace. */
const opensByLink = (user: User) =>
  user.passwordHash !== null && !user.mustChangePassword;

/**
 * `/api/auth/sign-in-link`: signing in to a local account from a link sent to
 * its address, with no password typed. Only on a server with `SMTP_URL`, and
 * switched by `MAGIC_LINKS`.
 *
 * Asking is `mailedLinks`, shared with reset by mail: always 204, whether or
 * not the address belongs to anyone, with the mail after the answer. No link
 * is made for an account that signs in elsewhere (no password here) or that
 * still holds a temporary password, which has to be replaced by the person
 * it was handed to before anything else opens the account.
 *
 * The link stands in for the password and for nothing else: an account with
 * a second factor is asked for it, on the same per-account budget as a
 * password sign-in, and a wrong answer leaves the link good, so the challenge
 * can be answered again with the link the mail brought.
 *
 * A link does not outlive a change to what it stands in for or where it was
 * sent: `endUserSessions` and both email changes void the account's links.
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
      // Made before the account lost its password or was handed a temporary
      // one: the link no longer opens it.
      if (!user || !opensByLink(user)) throw gone();
      // The budget guards what can be guessed, which here is the second
      // factor alone. An account without one is not held to it: anyone can
      // run the budget out with wrong passwords, and the link is the way in
      // that leaves its owner.
      const refuseIfLocked = () => {
        const wait = loginAttempts.retryAfter(user.username);
        if (wait > 0) {
          c.header("Retry-After", String(wait));
          throw new HttpError(429, "Too many sign-in attempts");
        }
      };
      // An answer to the second factor spends the link before it is looked
      // at, atomically: of two requests holding the same link one goes on,
      // and a link that ran out meanwhile costs no recovery code. A wrong
      // answer hands the link back.
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
      // A wrong answer is refused in there, with its attempt counted and
      // audited; all that is left to do here is hand the link back.
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
      // Only a second factor that held clears the count: a link by itself
      // proves nothing about who has been guessing at the password.
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
