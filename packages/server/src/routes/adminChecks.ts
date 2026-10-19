import {
  type AdminChecksResponse,
  type AdminTestMailResponse,
  PROXY_PROBE_ADDRESS,
  type ProxyFinding,
} from "@manifesto/shared";
import type { Hono } from "hono";
import type { ServerConfig } from "#/config.ts";
import { jobStatuses } from "#/lib/periodic.ts";
import type { Mailer, MailStatus } from "#/mail/mailer.ts";
import { mailLocale, testMail } from "#/mail/templates.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";

type AuthedApp = Hono<{ Variables: { auth: AuthContext } }>;

interface AdminChecksDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  /** The mailer of the server and its status. Null without `SMTP_URL`. */
  mail?: (Mailer & { status(): MailStatus }) | null | undefined;
}

/**
 * What a proxy did to the probe that the client sent as `X-Forwarded-For`. A
 * proxy that overwrites leaves one address that is not the probe. A proxy that
 * appends keeps the probe in front of the address that it saw.
 */
export function proxyFinding(forwardedFor: string | undefined): ProxyFinding {
  const hops = (forwardedFor ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop !== "");
  if (hops.length === 0) return "removed";
  if (!hops.includes(PROXY_PROBE_ADDRESS)) return "overwritten";
  return hops.length === 1 ? "untouched" : "appended";
}

/**
 * `/api/v1/admin/checks`: the facts behind the setup checks of the overview,
 * which can be wrong without a message. Registered on the admin router. The
 * request itself is part of the answer: the check judges the proxy in front of
 * the server by what it did to this request.
 */
export function registerAdminCheckRoutes(
  admin: AuthedApp,
  deps: AdminChecksDeps,
) {
  const { cfg, storage } = deps;

  admin.get("/checks", (c) => {
    const backupJob = jobStatuses().find(
      (job) => job.name === "scheduled backup",
    );
    const body: AdminChecksResponse = {
      appUrl: cfg.appUrl,
      trustProxy: cfg.trustProxy,
      proxy: proxyFinding(c.req.header("x-forwarded-for")),
      backup:
        cfg.storageDriver === "sqlite"
          ? {
              scheduled: cfg.backup !== null,
              lastFinishedAt: backupJob?.lastFinishedAt ?? null,
              lastError: backupJob?.lastError ?? null,
            }
          : null,
      mail: deps.mail ? deps.mail.status() : null,
    };
    return c.json(body);
  });

  /** A message to the own address of the admin, to see that mail arrives. */
  admin.post("/checks/mail", async (c) => {
    const { mail } = deps;
    if (!mail || !cfg.mail) throw new HttpError(409, "Mail is not set up");
    const user = await storage.users.findById(c.get("auth").userId);
    if (!user?.email) {
      throw new HttpError(409, "The account has no email address");
    }
    const sent = await mail.send({
      to: user.email,
      ...testMail(mailLocale(user.locale?.split("-")[0]), {
        link: cfg.mail.appUrl,
      }),
    });
    const body: AdminTestMailResponse = { sent };
    return c.json(body);
  });
}
