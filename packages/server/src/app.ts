import { MAX_IMAGE_SOURCE_BYTES } from "@manifesto/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { recordClientAddress } from "./audit/audit.js";
import { createLoginAttempts } from "./auth/local/loginAttempts.js";
import {
  createSessionRevocations,
  type SessionRevocations,
} from "./auth/revocations.js";
import { createAuthSharedRoutes } from "./auth/sharedRoutes.js";
import type { AuthProvider } from "./auth/types.js";
import { createCalendarRoutes } from "./calendar/routes.js";
import { mountClient } from "./client/serveClient.js";
import { offersMcpSignIn, type ServerConfig } from "./config.js";
import type { UpdateStatus } from "./jobs/updateCheck.js";
import { countMetric } from "./lib/metrics.js";
import { metricsHandler } from "./lib/metricsServer.js";
import { MAX_REQUEST_BYTES } from "./lib/requestLimits.js";
import {
  createLinkPreviewFetcher,
  type LinkPreviewFetcher,
} from "./linkPreview/fetchPreview.js";
import { createSmtpMailer, type Mailer } from "./mail/mailer.js";
import { createMcpRoutes } from "./mcp/routes.js";
import { corsMiddleware } from "./middleware/cors.js";
import { HttpError, onError } from "./middleware/error.js";
import { createProtection } from "./middleware/protect.js";
import { requestLog } from "./middleware/requestLog.js";
import {
  type ClientMetadataFetcher,
  createClientResolver,
} from "./oauth/clients.js";
import {
  createOAuthRoutes,
  createWellKnownRoutes,
  resourceMetadataChallenge,
} from "./oauth/routes.js";
import { buildOpenApiDocument } from "./openapi.js";
import { createAdminRoutes } from "./routes/admin.js";
import { createAttachmentRoutes } from "./routes/attachments.js";
import { createCapabilitiesRoutes } from "./routes/capabilities.js";
import { createExportRoutes } from "./routes/export.js";
import { createLinkPreviewRoutes } from "./routes/linkPreview.js";
import { createNotesRoutes } from "./routes/notes.js";
import { createPublicRoutes } from "./routes/publicLinks.js";
import { createSearchRoutes } from "./routes/search.js";
import { createInvitationRoutes } from "./routes/shares.js";
import { createSyncRoutes } from "./routes/sync.js";
import { createTeamRoutes } from "./routes/teams.js";
import { createTokenRoutes } from "./routes/tokens.js";
import { createUsersRoutes } from "./routes/users.js";
import { createWebhookRoutes } from "./routes/webhooks.js";
import {
  type AccessChanges,
  createAccessChanges,
} from "./sharing/accessChanges.js";
import { createNoteEvents, type NoteEvents } from "./sharing/noteEvents.js";
import { createTeamShares } from "./sharing/teamShares.js";
import { syncOidcTeams } from "./sharing/teamSync.js";
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
  /** Test seam: reads an OAuth client's metadata document. */
  fetchClientMetadata?: ClientMetadataFetcher;
  /** Test seam: replaces the SMTP mailer `cfg.mail` would build. */
  mailer?: Mailer;
  /** Log every request. The server turns this on; tests leave it off. */
  logRequests?: boolean;
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
  const teamShares = createTeamShares({
    storage,
    broadcaster,
    noteEvents,
    accessChanges,
  });
  // One budget of wrong passwords per account name, whether they were typed
  // to sign in or to confirm an action from a session that is already in.
  const loginAttempts = createLoginAttempts();
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
  if (deps.logRequests) app.use("*", requestLog());
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
  // Two caps. Image uploads are the one route that carries bulk, a raw file
  // up to the image limit; everything else, notes included (their images and
  // preview images are references), has no reason to exceed 1 MiB.
  const onBodyTooLarge = () => {
    throw new HttpError(413, "Request body too large");
  };
  const defaultBodyLimit = bodyLimit({
    maxSize: MAX_REQUEST_BYTES,
    onError: onBodyTooLarge,
  });
  // An image upload is one raw file, up to the image limit.
  const attachmentBodyLimit = bodyLimit({
    maxSize: MAX_IMAGE_SOURCE_BYTES + 64 * 1024,
    onError: onBodyTooLarge,
  });
  app.use("/api/*", (c, next) =>
    c.req.path === "/api/attachments"
      ? attachmentBodyLimit(c, next)
      : defaultBodyLimit(c, next),
  );

  app.get("/api/health", (c) => c.json({ ok: true, version: VERSION }));
  app.route("/api/capabilities", createCapabilitiesRoutes(cfg));
  let openApi: ReturnType<typeof buildOpenApiDocument> | undefined;
  app.get("/api/openapi.json", (c) => {
    openApi ??= buildOpenApiDocument(VERSION);
    return c.json(openApi);
  });

  // Before the protection below, so it sees the 401 that refuses a request
  // without a token, and says where an assistant can sign in.
  if (offersMcpSignIn(cfg)) {
    app.use("/api/mcp", resourceMetadataChallenge(cfg.trustProxy));
  }
  // Who may call each route and how often, as `OPERATIONS` declares it.
  // Routers mount none of this themselves.
  app.use(
    "/api/*",
    createProtection({ authProvider, storage, trustProxy: cfg.trustProxy }),
  );

  // Provider-agnostic auth routes (/methods, /me) must be registered BEFORE
  // the provider's own router so Hono's longest-prefix matching reaches them.
  app.route(
    "/api/auth",
    createAuthSharedRoutes({
      cfg,
      storage,
      broadcaster,
      loginAttempts,
    }),
  );
  app.route(
    "/api/auth",
    authProvider.router({
      revocations,
      mailer,
      loginAttempts,
      teamSync: (userId, groups) =>
        syncOidcTeams(storage, teamShares, userId, groups),
    }),
  );
  app.route(
    "/api/notes",
    createNotesRoutes({
      storage,
      broadcaster,
      noteEvents,
      accessChanges,
      mail,
      cfg,
      teamShares,
    }),
  );
  app.route(
    "/api/invitations",
    createInvitationRoutes({
      storage,
      broadcaster,
      noteEvents,
      accessChanges,
    }),
  );
  app.route("/api/users", createUsersRoutes({ cfg, storage }));
  app.route("/api/export", createExportRoutes({ storage }));

  app.route(
    "/api/tokens",
    createTokenRoutes({
      storage,
      revocations,
      loginAttempts,
      mcpEnabled: cfg.mcp,
    }),
  );
  if (offersMcpSignIn(cfg)) {
    app.route("/.well-known", createWellKnownRoutes(cfg));
    app.route(
      "/api/oauth",
      createOAuthRoutes({
        storage,
        loginAttempts,
        revocations,
        resolveClient: createClientResolver({
          storage,
          fetchMetadata: deps.fetchClientMetadata,
        }),
      }),
    );
  }
  if (cfg.mcp) {
    // Its tools call the routes above through the app itself, so they meet
    // every check a request from the network does.
    app.route(
      "/api/mcp",
      createMcpRoutes({
        corsOrigins: cfg.corsOrigins,
        serverVersion: VERSION,
        forward: (request, env) => app.fetch(request, env),
      }),
    );
  }
  // Off, there are no routes to answer, so a request is a 404 before it is
  // asked to sign in.
  if (webhooks) {
    app.route(
      "/api/webhooks",
      createWebhookRoutes({ storage, loginAttempts, dispatcher: webhooks }),
    );
  }
  app.route(
    "/api/attachments",
    createAttachmentRoutes({
      storage,
    }),
  );
  app.route("/api/search", createSearchRoutes({ storage }));
  app.route("/api/public", createPublicRoutes({ storage, cfg }));
  app.route("/api/calendar", createCalendarRoutes({ storage, cfg }));
  app.route("/api/teams", createTeamRoutes({ storage }));
  app.route("/api/sync", createSyncRoutes({ storage }));
  app.route(
    "/api/link-preview",
    createLinkPreviewRoutes({
      fetchPreview: cfg.linkPreviews
        ? (deps.fetchLinkPreview ?? createLinkPreviewFetcher())
        : null,
    }),
  );

  app.route(
    "/api/admin",
    createAdminRoutes({
      cfg,
      teamShares,
      storage,
      revocations,
      noteEvents,
      updateStatus: deps.updateStatus,
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
