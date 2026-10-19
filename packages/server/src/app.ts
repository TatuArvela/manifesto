import { MAX_IMAGE_SOURCE_BYTES } from "@manifesto/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { recordClientAddress } from "./audit/audit.ts";
import { createLoginAttempts } from "./auth/local/loginAttempts.ts";
import {
  createSessionRevocations,
  type SessionRevocations,
} from "./auth/revocations.ts";
import { createAuthSharedRoutes } from "./auth/sharedRoutes.ts";
import type { AuthProvider } from "./auth/types.ts";
import { createCalendarRoutes } from "./calendar/routes.ts";
import { mountClient } from "./client/serveClient.ts";
import { offersMcpSignIn, type ServerConfig } from "./config.ts";
import { isFeatureOn } from "./features.ts";
import type { UpdateStatus } from "./jobs/updateCheck.ts";
import { countMetric } from "./lib/metrics.ts";
import { metricsHandler } from "./lib/metricsServer.ts";
import { MAX_REQUEST_BYTES } from "./lib/requestLimits.ts";
import {
  createLinkPreviewFetcher,
  type LinkPreviewFetcher,
} from "./linkPreview/fetchPreview.ts";
import {
  createSmtpMailer,
  type Mailer,
  withMailStatus,
} from "./mail/mailer.ts";
import { createMcpRoutes } from "./mcp/routes.ts";
import { corsMiddleware } from "./middleware/cors.ts";
import { HttpError, onError } from "./middleware/error.ts";
import { createProtection } from "./middleware/protect.ts";
import { requestLog } from "./middleware/requestLog.ts";
import {
  type ClientMetadataFetcher,
  createClientResolver,
} from "./oauth/clients.ts";
import {
  createOAuthRoutes,
  createWellKnownRoutes,
  resourceMetadataChallenge,
} from "./oauth/routes.ts";
import { buildOpenApiDocument } from "./openapi.ts";
import { createPushSender, type PushSender } from "./push/sender.ts";
import { createAdminRoutes } from "./routes/admin.ts";
import { createAttachmentRoutes } from "./routes/attachments.ts";
import { createCapabilitiesRoutes } from "./routes/capabilities.ts";
import { createLinkPreviewRoutes } from "./routes/linkPreview.ts";
import { createNotesRoutes } from "./routes/notes.ts";
import { createPublicRoutes } from "./routes/publicLinks.ts";
import { createPushRoutes } from "./routes/push.ts";
import { createSearchRoutes } from "./routes/search.ts";
import { createInvitationRoutes } from "./routes/shares.ts";
import { createSyncRoutes } from "./routes/sync.ts";
import { createTeamRoutes } from "./routes/teams.ts";
import { createTokenRoutes } from "./routes/tokens.ts";
import { createUsersRoutes } from "./routes/users.ts";
import { createWebhookRoutes } from "./routes/webhooks.ts";
import {
  type AccessChanges,
  createAccessChanges,
} from "./sharing/accessChanges.ts";
import { createNoteEvents, type NoteEvents } from "./sharing/noteEvents.ts";
import { createTeamShares } from "./sharing/teamShares.ts";
import { syncOidcTeams } from "./sharing/teamSync.ts";
import type { StorageDriver } from "./storage/types.ts";
import { VERSION } from "./version.ts";
import {
  createWebhookDispatcher,
  type WebhookDispatcher,
} from "./webhooks/dispatcher.ts";
import { type Broadcaster, createBroadcaster } from "./ws/broadcaster.ts";

export interface AppDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  authProvider: AuthProvider;
  broadcaster?: Broadcaster;
  /** Where the server announces ended sessions to the sockets. */
  revocations?: SessionRevocations;
  /** Where the server announces lost access to a note to the sockets. */
  accessChanges?: AccessChanges;
  /** Test seam: replaces the fetcher that connects to the network. */
  fetchLinkPreview?: LinkPreviewFetcher;
  /**
   * Test seam: the addresses that webhooks can reach, and their retry speed.
   */
  webhookAddressPolicy?: (address: string) => boolean;
  webhookRetryDelaysMs?: number[];
  /** Test seam: the addresses that push messages can reach, on any port. */
  pushAddressPolicy?: (address: string) => boolean;
  /** Test seam: reads the metadata document of an OAuth client. */
  fetchClientMetadata?: ClientMetadataFetcher;
  /** Test seam: replaces the SMTP mailer that `cfg.mail` would build. */
  mailer?: Mailer;
  /** Log each request. The server turns this on. Tests keep it off. */
  logRequests?: boolean;
  /** What the update check found. index.ts starts it. The overview reads it. */
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
  /** Sends push messages. The reminder job in index.ts uses it. */
  pushSender: PushSender;
}

export function createApp(deps: AppDeps): AppHandle {
  const { cfg, storage, authProvider } = deps;
  const broadcaster = deps.broadcaster ?? createBroadcaster();
  const revocations = deps.revocations ?? createSessionRevocations();
  const accessChanges = deps.accessChanges ?? createAccessChanges();
  const noteEvents = createNoteEvents({ storage, broadcaster, accessChanges });
  const teamShares = createTeamShares({
    storage,
    noteEvents,
    accessChanges,
  });
  // One budget of wrong passwords for each account name, for passwords typed to
  // sign in and for passwords typed to confirm an action from a session.
  const loginAttempts = createLoginAttempts();
  const smtp = deps.mailer ?? (cfg.mail ? createSmtpMailer(cfg.mail) : null);
  // All sends go through this one. Thus, the setup checks also see real mail.
  const mailer = smtp ? withMailStatus(smtp) : null;
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

  const pushSender = createPushSender({
    storage,
    cfg,
    isAllowedAddress: deps.pushAddressPolicy,
    allowAnyPort: deps.pushAddressPolicy !== undefined,
  });

  const app = new Hono();
  app.use("*", corsMiddleware(cfg));
  if (deps.logRequests) app.use("*", requestLog());
  app.onError(onError);
  app.use("/api/v1/*", recordClientAddress(cfg.trustProxy));
  // Requests by method and status class, and their duration. The route is not a
  // label, because note ids in paths would make one series for each note.
  app.use("/api/v1/*", async (c, next) => {
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

  // Prometheus scrapes this. On the public port, only with METRICS_TOKEN, and
  // never when METRICS_PORT gives metrics their own port. Counts of sockets and
  // failures are not for all persons.
  if (!cfg.metricsPort) {
    app.get("/metrics", metricsHandler(cfg, VERSION, true));
  }

  // Limit the request bodies on /api/v1/*. Without this, an authenticated user
  // could POST a JSON body of many MB and use up the memory of the server.
  //
  // There are two limits. Image uploads are the only route that carries bulk
  // data: a raw file up to the image limit. All other routes, also notes (their
  // images and preview images are references), have no reason to be larger than
  // 1 MiB.
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
  app.use("/api/v1/*", (c, next) =>
    c.req.path === "/api/v1/attachments"
      ? attachmentBodyLimit(c, next)
      : defaultBodyLimit(c, next),
  );

  // Addresses that other systems keep from before the API had a version: the
  // feed of a calendar app, and the MCP server of an assistant. Each one goes
  // to its place under /api/v1, with its method and body (308). Thus, nobody
  // has to set them up again. Nothing else under the old /api/ answers.
  for (const legacy of ["/api/calendar/*", "/api/mcp"]) {
    app.all(legacy, (c) => {
      const { pathname, search } = new URL(c.req.url);
      return c.redirect(
        `/api/v1${pathname.slice("/api".length)}${search}`,
        308,
      );
    });
  }

  app.get("/api/v1/health", (c) => c.json({ ok: true, version: VERSION }));
  app.route("/api/v1/capabilities", createCapabilitiesRoutes(cfg));
  let openApi: ReturnType<typeof buildOpenApiDocument> | undefined;
  app.get("/api/v1/openapi.json", (c) => {
    openApi ??= buildOpenApiDocument(VERSION);
    return c.json(openApi);
  });

  // Before the protection below. Thus, it sees the 401 that refuses a request
  // without a token, and tells where an assistant can sign in.
  if (offersMcpSignIn(cfg)) {
    app.use("/api/v1/mcp", resourceMetadataChallenge(cfg.trustProxy));
  }
  // Who can call each route and how frequently, as `OPERATIONS` declares it,
  // and a 404 for the routes of a feature that is off (`features.ts`). Routers
  // mount none of this themselves.
  app.use("/api/v1/*", createProtection({ authProvider, storage, cfg }));

  // Register the auth routes that do not depend on the provider (/methods, /me)
  // BEFORE the own router of the provider. Thus, the longest-prefix match of
  // Hono reaches them.
  app.route(
    "/api/v1/auth",
    createAuthSharedRoutes({
      cfg,
      storage,
      broadcaster,
      loginAttempts,
      revocations,
      noteEvents,
    }),
  );
  app.route(
    "/api/v1/auth",
    authProvider.router({
      revocations,
      mailer,
      loginAttempts,
      // With teams off, a sign-in does not change membership. No route decides
      // this. Thus, it asks the registry itself.
      teamSync: async (userId, groups) => {
        if (isFeatureOn(cfg, "teams")) {
          await syncOidcTeams(storage, teamShares, userId, groups);
        }
      },
    }),
  );
  app.route(
    "/api/v1/notes",
    createNotesRoutes({
      storage,
      noteEvents,
      accessChanges,
      mail,
      cfg,
      teamShares,
    }),
  );
  app.route(
    "/api/v1/invitations",
    createInvitationRoutes({
      storage,
      noteEvents,
      accessChanges,
    }),
  );
  app.route("/api/v1/users", createUsersRoutes({ cfg, storage }));

  app.route(
    "/api/v1/tokens",
    createTokenRoutes({
      storage,
      revocations,
      loginAttempts,
      cfg,
    }),
  );
  if (offersMcpSignIn(cfg)) {
    app.route("/.well-known", createWellKnownRoutes(cfg));
    app.route(
      "/api/v1/oauth",
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
  // Its tools call the routes above through the app itself. Thus, they meet all
  // checks that a request from the network meets. With `MCP=off`, the
  // protection answers 404 before all of it.
  app.route(
    "/api/v1/mcp",
    createMcpRoutes({
      corsOrigins: cfg.corsOrigins,
      serverVersion: VERSION,
      forward: (request, env) => app.fetch(request, env),
    }),
  );
  // When it is off, there is no dispatcher for the routes. Thus, they are not
  // mounted. If they were, the protection would answer them with the same 404.
  if (webhooks) {
    app.route(
      "/api/v1/webhooks",
      createWebhookRoutes({ storage, loginAttempts, dispatcher: webhooks }),
    );
  }
  app.route(
    "/api/v1/attachments",
    createAttachmentRoutes({
      storage,
    }),
  );
  app.route("/api/v1/search", createSearchRoutes({ storage }));
  app.route("/api/v1/public", createPublicRoutes({ storage }));
  app.route("/api/v1/calendar", createCalendarRoutes({ storage, cfg }));
  app.route("/api/v1/push", createPushRoutes({ storage, sender: pushSender }));
  app.route("/api/v1/teams", createTeamRoutes({ storage }));
  app.route("/api/v1/sync", createSyncRoutes({ storage }));
  app.route(
    "/api/v1/link-preview",
    createLinkPreviewRoutes({
      fetchPreview: deps.fetchLinkPreview ?? createLinkPreviewFetcher(),
    }),
  );

  app.route(
    "/api/v1/admin",
    createAdminRoutes({
      cfg,
      teamShares,
      storage,
      revocations,
      noteEvents,
      updateStatus: deps.updateStatus,
      mail: cfg.mail ? mailer : null,
    }),
  );

  // Last, so that all API routes above answer before the catch-all of the
  // client.
  if (cfg.clientDir) mountClient(app, cfg.clientDir);

  return {
    app,
    broadcaster,
    revocations,
    accessChanges,
    noteEvents,
    webhooks,
    pushSender,
  };
}
