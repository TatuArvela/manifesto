import type { AuditAction } from "@manifesto/shared";
import { audit } from "../../audit/audit.js";
import type { ServerConfig } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { hashToken, newSessionToken } from "../../lib/token.js";
import type { Mailer } from "../../mail/mailer.js";
import { type MailLocale, mailLocale } from "../../mail/templates.js";
import { HttpError } from "../../middleware/error.js";
import type {
  MailedLinksRepo,
  StorageDriver,
  User,
} from "../../storage/types.js";

/** The least time between two links of one kind for one account, so the
 * address cannot be used to flood someone's inbox. */
const LINK_COOLDOWN_MS = 5 * 60 * 1000;

/** What tells one kind of mailed link from the other. */
interface MailedLinkKind {
  links: MailedLinksRepo;
  /** The name in `APP_URL/#<fragment>=<token>`, which the client reads. */
  fragment: "reset" | "signin";
  minutes: number;
  /** Whether the account may be sent one at all. */
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
 * The half that reset by mail and sign-in by mail share: asking for a link.
 * The route answers 204 at once and calls `send`, which does its work after
 * the answer, so neither the answer nor its timing says which addresses have
 * accounts. Whatever goes wrong there is logged, never thrown.
 *
 * A link whose mail could not be sent is deleted: nobody holds it, and left
 * in place it would make the next five minutes of asking come to nothing.
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
