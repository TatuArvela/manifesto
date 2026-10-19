import type { MailConfig } from "#/config.ts";
import { logger } from "#/lib/logger.ts";
import { nowIso } from "#/lib/time.ts";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Outgoing mail. A send never throws into a request. The code logs a message
 * that could not go out, and the caller continues. Each mail that this server
 * sends is an extra service next to an action that already occurred (a
 * requested link, a shared note).
 */
export interface Mailer {
  send(message: MailMessage): Promise<boolean>;
}

/**
 * The SMTP mailer, over nodemailer. It is imported on the first use. Thus, a
 * server without `SMTP_URL` never loads it.
 */
export function createSmtpMailer(cfg: MailConfig): Mailer {
  let transport: Promise<{
    sendMail(options: {
      from: string;
      to: string;
      subject: string;
      text: string;
    }): Promise<unknown>;
  }> | null = null;
  return {
    async send(message) {
      try {
        transport ??= import("nodemailer").then((nodemailer) =>
          nodemailer.createTransport(cfg.url),
        );
        await (await transport).sendMail({ from: cfg.from, ...message });
        return true;
      } catch (err) {
        logger.warn("Mail could not be sent", {
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
  };
}

/** When mail last went out, and when it last could not. Null for never. */
export interface MailStatus {
  lastSentAt: string | null;
  lastFailedAt: string | null;
}

/**
 * The same mailer, which remembers the results of its sends, for the setup
 * checks of the admin. It is in memory, as the job statuses: it describes this
 * process since its start. The log tells why a send failed. This does not.
 */
export function withMailStatus(
  mailer: Mailer,
): Mailer & { status(): MailStatus } {
  const status: MailStatus = { lastSentAt: null, lastFailedAt: null };
  return {
    async send(message) {
      const sent = await mailer.send(message);
      status[sent ? "lastSentAt" : "lastFailedAt"] = nowIso();
      return sent;
    },
    status: () => ({ ...status }),
  };
}

/** Test seam: keeps what it was asked to send. */
export function createMemoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return true;
    },
  };
}
