import type { AuditAction } from "@manifesto/shared";
import { audit } from "#/audit/audit.ts";
import type { ServerConfig } from "#/config.ts";
import { logger } from "#/lib/logger.ts";
import { hashToken, newSessionToken } from "#/lib/token.ts";
import type { Mailer } from "#/mail/mailer.ts";
import { type MailLocale, mailLocale } from "#/mail/templates.ts";
import { HttpError } from "#/middleware/error.ts";
import type { MailedLinksRepo, StorageDriver, User } from "#/storage/types.ts";

/**
 * The minimum time between two links of one type for one account. Thus, nobody
 * can use the address to fill the inbox of a person.
 */
const LINK_COOLDOWN_MS = 5 * 60 * 1000;

/** What tells one type of mailed link from the other. */
interface MailedLinkKind {
  links: MailedLinksRepo;
  /** The name in `APP_URL/#<fragment>=<token>`, which the client reads. */
  fragment: "reset" | "signin";
  minutes: number;
  /** If the account can get one. */
  eligible(user: User): boolean;
  mail(
    locale: MailLocale,
    input: { username: string; link: string; minutes: number },
  ): { subject: string; text: string };
  /** The audit action of a link that went out. */
  requested: AuditAction;
  /** The 404 of a server with no mail. */
  notSetUp: string;
}

/**
 * The part that reset by mail and sign-in by mail share: the request for a
 * link. The route answers 204 immediately, and calls `send`, which does its
 * work after the answer. Thus, neither the answer nor its time tells which
 * addresses have accounts. The code logs each problem there, and never throws.
 *
 * The code deletes a link whose mail could not go out. Nobody has it. If it
 * stayed, each request in the next five minutes would give nothing.
 */
export function mailedLinks(
  deps: { storage: StorageDriver; cfg: ServerConfig; mailer: Mailer | null },
  kind: MailedLinkKind,
) {
  const { storage, mailer } = deps;
  const appUrl = deps.cfg.mail?.appUrl;

  const requireMail = () => {
    if (!mailer || !appUrl) throw new HttpError(404, kind.notSetUp);
    return { mailer, appUrl };
  };

  async function sendLink(
    email: string,
    locale: string | undefined,
    c: { req: object },
  ) {
    const { mailer, appUrl } = requireMail();
    const user = await storage.users.findByEmail(email);
    if (!user || !kind.eligible(user)) return;
    const latest = await kind.links.latestFor(user.id);
    if (latest && Date.now() - Date.parse(latest) < LINK_COOLDOWN_MS) return;
    const token = newSessionToken();
    const tokenHash = hashToken(token);
    const now = new Date();
    await kind.links.create({
      tokenHash,
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + kind.minutes * 60_000).toISOString(),
    });
    const message = kind.mail(mailLocale(locale), {
      username: user.username,
      link: `${appUrl}/#${kind.fragment}=${token}`,
      minutes: kind.minutes,
    });
    if (!(await mailer.send({ to: email, ...message }))) {
      await kind.links.delete(tokenHash);
      return;
    }
    audit(storage, c, { action: kind.requested, targetId: user.id });
  }

  return {
    /** Refuses with 404 where mail is not set up. */
    requireMail: (): void => void requireMail(),
    send(email: string, locale: string | undefined, c: { req: object }): void {
      void sendLink(email, locale, c).catch((err) => {
        logger.warn("A mailed link could not be made", {
          kind: kind.fragment,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    },
  };
}
