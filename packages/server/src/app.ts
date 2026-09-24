import { MAX_IMAGE_SOURCE_BYTES } from "@manifesto/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { audit, recordClientAddress } from "./audit/audit.js";
import {
  createSessionRevocations,
  type SessionRevocations,
} from "./auth/revocations.js";
import { createAuthSharedRoutes } from "./auth/sharedRoutes.js";
import type { AuthProvider } from "./auth/types.js";
import { mountClient } from "./client/serveClient.js";
import type { ServerConfig } from "./config.js";
import { exportAccount, sendExport } from "./export/userExport.js";
import { countMetric } from "./lib/metrics.js";
import { metricsHandler } from "./lib/metricsServer.js";
import type { UpdateStatus } from "./lib/updateCheck.js";
import {
  createLinkPreviewFetcher,
  type LinkPreviewFetcher,
} from "./linkPreview/fetchPreview.js";
import { createSmtpMailer, type Mailer } from "./mail/mailer.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "./middleware/authBearer.js";
import { corsMiddleware } from "./middleware/cors.js";
import { HttpError, onError } from "./middleware/error.js";
import { perUserApiRateLimit } from "./middleware/rateLimit.js";
import { requestLog } from "./middleware/requestLog.js";
import { buildOpenApiDocument } from "./openapi.js";
import { createAdminRoutes } from "./routes/admin.js";
import { createAttachmentRoutes } from "./routes/attachments.js";
import { createLinkPreviewRoutes } from "./routes/linkPreview.js";
import { createNotesRoutes } from "./routes/notes.js";
import { createSearchRoutes } from "./routes/search.js";
import { registerInvitationRoutes } from "./routes/shares.js";
import { createTokenRoutes } from "./routes/tokens.js";
import { createUsersRoutes } from "./routes/users.js";
import { createWebhookRoutes } from "./routes/webhooks.js";
import {
  type AccessChanges,
  createAccessChanges,
} from "./sharing/accessChanges.js";
import { createNoteEvents, type NoteEvents } from "./sharing/noteEvents.js";
import type { StorageDriver } from "./storage/types.js";
import { VERSION } from "./version.js";
import {
  createWebhookDispatcher,
  type WebhookDispatcher,
} from "./webhooks/dispatcher.js";
import { type Broadcaster, createBroadcaster } from "./ws/broadcaster.js";

export interface AppDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  authProvider: AuthProvider;
  broadcaster?: Broadcaster;
  /** Where ended sessions are announced to the sockets. */
  revocations?: SessionRevocations;
  /** Where lost access to a note is announced to the sockets. */
  accessChanges?: AccessChanges;
  /** Test seam: replaces the fetcher that reaches the network. */
  fetchLinkPreview?: LinkPreviewFetcher;
  /** Test seam: which addresses webhooks may reach, and how fast they retry. */
  webhookAddressPolicy?: (address: string) => boolean;
  webhookRetryDelaysMs?: number[];
  /** Test seam: replaces the SMTP mailer `cfg.mail` would build. */
  mailer?: Mailer;
  /** What the update check found; index.ts starts it, the overview reads it. */
  updateStatus?: () => UpdateStatus | null;
}

export interface AppHandle {
  app: Hono;
  broadcaster: Broadcaster;
  revocations: SessionRevocations;
  accessChanges: AccessChanges;
  noteEvents: NoteEvents;
  /** Null when the server has webhooks off. */
  webhooks: WebhookDispatcher | null;
}

export function createApp(deps: AppDeps): AppHandle {
  const { cfg, storage, authProvider } = deps;
  const broadcaster = deps.broadcaster ?? createBroadcaster();
  const revocations = deps.revocations ?? createSessionRevocations();
  const accessChanges = deps.accessChanges ?? createAccessChanges();
  const noteEvents = createNoteEvents({ storage, broadcaster, accessChanges });
  const mailer = deps.mailer ?? (cfg.mail ? createSmtpMailer(cfg.mail) : null);
  const mail = mailer && cfg.mail ? { mailer, appUrl: cfg.mail.appUrl } : null;
  const webhooks =
    cfg.webhooks === "off"
      ? null
      : createWebhookDispatcher({
          storage,
          broadcaster,
          mode: cfg.webhooks,
          isAllowedAddress: deps.webhookAddressPolicy,
          retryDelaysMs: deps.webhookRetryDelaysMs,
        });

  const app = new Hono();
  app.use("*", corsMiddleware(cfg));
  if (process.env.NODE_ENV !== "test") {
    app.use("*", requestLog());
  }
  app.onError(onError);
  app.use("/api/*", recordClientAddress(cfg.trustProxy));
  // Requests by method and status class, and the time they took. The route
  // is not a label: note ids in paths would make one series per note.
  app.use("/api/*", async (c, next) => {
    const started = performance.now();
    await next();
    const labels = {
      method: c.req.method,
      status: `${Math.floor(c.res.status / 100)}xx`,
    };
    countMetric(
      "manifesto_http_requests_total",
      "API requests, by method and status class.",
      labels,
    );
    countMetric(
      "manifesto_http_request_duration_seconds_sum",
      "Seconds spent answering API requests, by method and status class.",
      labels,
      (performance.now() - started) / 1000,
    );
  });

  // Prometheus scrapes this. On the public port only with METRICS_TOKEN and
  // never when METRICS_PORT gives metrics a port of their own: counts of
  // sockets and failures are not for everyone.
  if (!cfg.metricsPort) {
    app.get("/metrics", metricsHandler(cfg, VERSION, true));
  }

  // Cap request bodies on /api/*. Without this, an authenticated user could
  // POST a multi-MB JSON body and exhaust server memory.
  //
  // Two caps, because notes are the only route that legitimately carries bulk:
  // images are inlined as base64 `data:` URLs, so a note with attachments is
  // genuinely megabytes. Everything else (auth, search, health) has no reason
  // to exceed a small body, and holding those to 1 MiB keeps the wide envelope
  // scoped to the one path that needs it. This body limit, not
  // MAX_IMAGE_DATA_URL_BYTES, is what bounds a note in aggregate: twenty images
  // each individually under the per-image cap still cannot add up past this.
  const DEFAULT_BODY_LIMIT = 1024 * 1024;
  const NOTE_BODY_LIMIT = 12 * 1024 * 1024;
  const onBodyTooLarge = () => {
    throw new HttpError(413, "Request body too large");
  };
  const defaultBodyLimit = bodyLimit({
    maxSize: DEFAULT_BODY_LIMIT,
    onError: onBodyTooLarge,
  });
  const noteBodyLimit = bodyLimit({
    maxSize: NOTE_BODY_LIMIT,
    onError: onBodyTooLarge,
  });
  // An image upload is one raw file, up to the image limit.
  const attachmentBodyLimit = bodyLimit({
    maxSize: MAX_IMAGE_SOURCE_BYTES + 64 * 1024,
    onError: onBodyTooLarge,
  });
  app.use("/api/*", (c, next) =>
    c.req.path.startsWith("/api/notes")
      ? noteBodyLimit(c, next)
      : c.req.path === "/api/attachments"
        ? attachmentBodyLimit(c, next)
        : defaultBodyLimit(c, next),
  );

  app.get("/api/health", (c) => c.json({ ok: true, version: VERSION }));
  let openApi: ReturnType<typeof buildOpenApiDocument> | undefined;
  app.get("/api/openapi.json", (c) => {
    openApi ??= buildOpenApiDocument(VERSION);
    return c.json(openApi);
  });

  // Single shared per-user rate limiter for the data-plane endpoints. Sharing
  // one instance across both routers means a user spamming a mix of
  // /api/notes and /api/search can't dodge throttling by alternating.
  const apiRateLimit = perUserApiRateLimit();

  // Provider-agnostic auth routes (/methods, /me) must be registered BEFORE
  // the provider's own router so Hono's longest-prefix matching reaches them.
  app.route(
    "/api/auth",
    createAuthSharedRoutes({ cfg, storage, authProvider }),
  );
  app.route("/api/auth", authProvider.router({ revocations, mailer }));
  app.route(
    "/api/notes",
    createNotesRoutes({
      storage,
      authProvider,
      broadcaster,
      noteEvents,
      accessChanges,
      rateLimit: apiRateLimit,
      mail,
    }),
  );
  const invitations = new Hono<{ Variables: { auth: AuthContext } }>();
  invitations.use("*", createAuthMiddleware(authProvider));
  invitations.use("*", apiRateLimit);
  registerInvitationRoutes(invitations, {
    storage,
    broadcaster,
    noteEvents,
    accessChanges,
  });
  app.route("/api/invitations", invitations);
  app.route(
    "/api/users",
    createUsersRoutes({ cfg, storage, authProvider, rateLimit: apiRateLimit }),
  );
  // The account's own notes, all of them, as a zip. Any credential will do,
  // an API token included, so a backup can be scripted.
  const exportRoute = new Hono<{ Variables: { auth: AuthContext } }>();
  exportRoute.use("*", createAuthMiddleware(authProvider));
  exportRoute.use("*", apiRateLimit);
  exportRoute.get("/", async (c) => {
    const { userId } = c.get("auth");
    const zip = await exportAccount(storage, userId);
    if (!zip) throw new HttpError(401, "User not found");
    audit(storage, c, { action: "account.exported", actorId: userId });
    return sendExport(c, zip, (await storage.users.findById(userId))?.username);
  });
  app.route("/api/export", exportRoute);

  app.route(
    "/api/tokens",
    createTokenRoutes({
      storage,
      authProvider,
      revocations,
      rateLimit: apiRateLimit,
    }),
  );
  app.route(
    "/api/webhooks",
    createWebhookRoutes({
      storage,
      authProvider,
      dispatcher: webhooks,
      rateLimit: apiRateLimit,
    }),
  );
  app.route(
    "/api/attachments",
    createAttachmentRoutes({
      storage,
      authProvider,
      // Its own bucket, and a wider one: a grid of notes asks for an image per
      // card, and each is fetched once per session and then cached.
      rateLimit: perUserApiRateLimit(1200),
    }),
  );
  app.route(
    "/api/search",
    createSearchRoutes({ storage, authProvider, rateLimit: apiRateLimit }),
  );
  app.route(
    "/api/link-preview",
    createLinkPreviewRoutes({
      authProvider,
      fetchPreview: cfg.linkPreviews
        ? (deps.fetchLinkPreview ?? createLinkPreviewFetcher())
        : null,
      rateLimit: apiRateLimit,
    }),
  );

  app.route(
    "/api/admin",
    createAdminRoutes({
      cfg,
      storage,
      authProvider,
      revocations,
      noteEvents,
      updateStatus: deps.updateStatus,
      rateLimit: apiRateLimit,
    }),
  );

  // Last, so every API route above answers before the client's catch-all.
  if (cfg.clientDir) mountClient(app, cfg.clientDir);

  return {
    app,
    broadcaster,
    revocations,
    accessChanges,
    noteEvents,
    webhooks,
  };
}
