import type { MailConfig } from "../config.js";
import { logger } from "../lib/logger.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Outgoing mail. Sending never throws into a request: a message that could
 * not go is logged, and the caller carries on, since every mail this server
 * sends is a convenience beside something that already happened (a link
 * requested, a note shared).
 */
export interface Mailer {
  send(message: MailMessage): Promise<boolean>;
}

/**
 * The SMTP mailer, over nodemailer. Imported on first use, so a server with no
 * `SMTP_URL` never loads it.
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
