import type { AdminChecksResponse } from "@manifesto/shared";
import type { MessageKey } from "#/i18n/index.ts";

export type SetupCheckStatus = "ok" | "info" | "warn";

/**
 * One line of the setup checks of the overview, as keys that the render
 * translates.
 */
export interface SetupCheck {
  id: "https" | "appUrl" | "proxy" | "backup" | "mail";
  status: SetupCheckStatus;
  title: MessageKey;
  message: MessageKey;
  vars?: Record<string, string>;
  /** A time that the message names, for the render to format. */
  when?: string;
  /** The section of the deployment guide that tells how to correct it. */
  docs?: string;
}

/** The location of the page, as `location` has it. */
export interface PageAddress {
  protocol: string;
  hostname: string;
  origin: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const DOCS =
  "https://github.com/TatuArvela/manifesto/blob/main/docs/specification/server/deployment.md";

function https(page: PageAddress): SetupCheck {
  const title = "checks.https.title";
  if (page.protocol === "https:") {
    return { id: "https", status: "ok", title, message: "checks.https.ok" };
  }
  if (LOCAL_HOSTS.has(page.hostname)) {
    return {
      id: "https",
      status: "info",
      title,
      message: "checks.https.local",
    };
  }
  return {
    id: "https",
    status: "warn",
    title,
    message: "checks.https.warn",
    docs: `${DOCS}#reverse-proxy`,
  };
}

function appUrl(appUrl: string | null, page: PageAddress): SetupCheck {
  const title = "checks.appUrl.title";
  if (appUrl === null) {
    return {
      id: "appUrl",
      status: "info",
      title,
      message: "checks.appUrl.unset",
      docs: `${DOCS}#environment-variables`,
    };
  }
  if (new URL(appUrl).origin === page.origin) {
    return { id: "appUrl", status: "ok", title, message: "checks.appUrl.ok" };
  }
  return {
    id: "appUrl",
    status: "warn",
    title,
    message: "checks.appUrl.mismatch",
    vars: { appUrl, origin: page.origin },
    docs: `${DOCS}#environment-variables`,
  };
}

/**
 * The proxy, from what it did to the probe, and if the server believes
 * `X-Forwarded-For`. It is correct to trust the header exactly when a proxy
 * replaces it. All other pairs either let a client select the address of its
 * throttle, or put all clients in one bucket.
 */
function proxy({ proxy, trustProxy }: AdminChecksResponse): SetupCheck {
  const check = (
    status: SetupCheckStatus,
    message: MessageKey,
    docs?: string,
  ): SetupCheck => ({
    id: "proxy",
    status,
    title: "checks.proxy.title",
    message,
    ...(docs !== undefined && { docs: `${DOCS}#${docs}` }),
  });
  const headerDocs = "x-forwarded-for-must-be-overwritten-not-appended";
  switch (proxy) {
    case "overwritten":
      return trustProxy
        ? check("ok", "checks.proxy.trusted")
        : check("warn", "checks.proxy.notTrusted", headerDocs);
    case "appended":
      return trustProxy
        ? check("warn", "checks.proxy.appendsTrusted", headerDocs)
        : check("info", "checks.proxy.appends", headerDocs);
    case "untouched":
      return trustProxy
        ? check(
            "warn",
            "checks.proxy.bypassed",
            "do-not-publish-the-server-port",
          )
        : check("ok", "checks.proxy.none");
    case "removed":
      return trustProxy
        ? check("warn", "checks.proxy.missingHeader", headerDocs)
        : check("ok", "checks.proxy.none");
  }
}

function backup(
  backup: NonNullable<AdminChecksResponse["backup"]>,
): SetupCheck {
  const title = "checks.backup.title";
  const docs = `${DOCS}#scheduled-backups`;
  if (!backup.scheduled) {
    return {
      id: "backup",
      status: "info",
      title,
      message: "checks.backup.off",
      docs,
    };
  }
  if (backup.lastError !== null) {
    return {
      id: "backup",
      status: "warn",
      title,
      message: "checks.backup.failed",
      vars: { error: backup.lastError },
      docs,
    };
  }
  if (backup.lastFinishedAt === null) {
    return {
      id: "backup",
      status: "ok",
      title,
      message: "checks.backup.pending",
    };
  }
  return {
    id: "backup",
    status: "ok",
    title,
    message: "checks.backup.ok",
    when: backup.lastFinishedAt,
  };
}

function mail(mail: AdminChecksResponse["mail"]): SetupCheck {
  const title = "checks.mail.title";
  if (mail === null) {
    return {
      id: "mail",
      status: "info",
      title,
      message: "checks.mail.off",
      docs: `${DOCS}#environment-variables`,
    };
  }
  const { lastSentAt, lastFailedAt } = mail;
  if (
    lastFailedAt !== null &&
    (lastSentAt === null || lastFailedAt > lastSentAt)
  ) {
    return {
      id: "mail",
      status: "warn",
      title,
      message: "checks.mail.failed",
      when: lastFailedAt,
    };
  }
  if (lastSentAt !== null) {
    return {
      id: "mail",
      status: "ok",
      title,
      message: "checks.mail.ok",
      when: lastSentAt,
    };
  }
  return { id: "mail", status: "info", title, message: "checks.mail.untested" };
}

/**
 * The setup checks, from the report of the server and the address of this page.
 * HTTPS and `APP_URL` are judged here, because only the browser knows the
 * address that it used.
 */
export function setupChecks(
  facts: AdminChecksResponse,
  page: PageAddress,
): SetupCheck[] {
  return [
    https(page),
    appUrl(facts.appUrl, page),
    proxy(facts),
    ...(facts.backup ? [backup(facts.backup)] : []),
    mail(facts.mail),
  ];
}
