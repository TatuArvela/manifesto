import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  createSessionRevocations,
  type SessionRevocations,
} from "./auth/revocations.js";
import { createAuthSharedRoutes } from "./auth/sharedRoutes.js";
import type { AuthProvider } from "./auth/types.js";
import type { ServerConfig } from "./config.js";
import {
  createLinkPreviewFetcher,
  type LinkPreviewFetcher,
} from "./linkPreview/fetchPreview.js";
import {
  type AuthContext,
  createAuthMiddleware,
} from "./middleware/authBearer.js";
import { corsMiddleware } from "./middleware/cors.js";
import { HttpError, onError } from "./middleware/error.js";
import { perUserApiRateLimit } from "./middleware/rateLimit.js";
import { requestLog } from "./middleware/requestLog.js";
import { createAdminRoutes } from "./routes/admin.js";
import { createAttachmentRoutes } from "./routes/attachments.js";
import { createLinkPreviewRoutes } from "./routes/linkPreview.js";
import { createNotesRoutes } from "./routes/notes.js";
import { createSearchRoutes } from "./routes/search.js";
import { registerInvitationRoutes } from "./routes/shares.js";
import { createUsersRoutes } from "./routes/users.js";
import {
  type AccessChanges,
  createAccessChanges,
} from "./sharing/accessChanges.js";
import { createNoteEvents, type NoteEvents } from "./sharing/noteEvents.js";
import type { StorageDriver } from "./storage/types.js";
import { VERSION } from "./version.js";
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
}

export interface AppHandle {
  app: Hono;
  broadcaster: Broadcaster;
  revocations: SessionRevocations;
  accessChanges: AccessChanges;
  noteEvents: NoteEvents;
}

export function createApp(deps: AppDeps): AppHandle {
  const { cfg, storage, authProvider } = deps;
  const broadcaster = deps.broadcaster ?? createBroadcaster();
  const revocations = deps.revocations ?? createSessionRevocations();
  const accessChanges = deps.accessChanges ?? createAccessChanges();
  const noteEvents = createNoteEvents({ storage, broadcaster, accessChanges });

  const app = new Hono();
  app.use("*", corsMiddleware(cfg));
  if (process.env.NODE_ENV !== "test") {
    app.use("*", requestLog());
  }
  app.onError(onError);

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
  app.use("/api/*", (c, next) =>
    c.req.path.startsWith("/api/notes")
      ? noteBodyLimit(c, next)
      : defaultBodyLimit(c, next),
  );

  app.get("/api/health", (c) => c.json({ ok: true, version: VERSION }));

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
  app.route("/api/auth", authProvider.router({ revocations }));
  app.route(
    "/api/notes",
    createNotesRoutes({
      storage,
      authProvider,
      broadcaster,
      noteEvents,
      accessChanges,
      rateLimit: apiRateLimit,
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
      rateLimit: apiRateLimit,
    }),
  );

  return { app, broadcaster, revocations, accessChanges, noteEvents };
}
