import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createAuthSharedRoutes } from "./auth/sharedRoutes.js";
import type { AuthProvider } from "./auth/types.js";
import type { ServerConfig } from "./config.js";
import {
  createLinkPreviewFetcher,
  type LinkPreviewFetcher,
} from "./linkPreview/fetchPreview.js";
import { corsMiddleware } from "./middleware/cors.js";
import { HttpError, onError } from "./middleware/error.js";
import { perUserApiRateLimit } from "./middleware/rateLimit.js";
import { requestLog } from "./middleware/requestLog.js";
import { createLinkPreviewRoutes } from "./routes/linkPreview.js";
import { createNotesRoutes } from "./routes/notes.js";
import { createSearchRoutes } from "./routes/search.js";
import type { StorageDriver } from "./storage/types.js";
import { VERSION } from "./version.js";
import { type Broadcaster, createBroadcaster } from "./ws/broadcaster.js";

export interface AppDeps {
  cfg: ServerConfig;
  storage: StorageDriver;
  authProvider: AuthProvider;
  broadcaster?: Broadcaster;
  /** Test seam: replaces the fetcher that reaches the network. */
  fetchLinkPreview?: LinkPreviewFetcher;
}

export interface AppHandle {
  app: Hono;
  broadcaster: Broadcaster;
}

export function createApp(deps: AppDeps): AppHandle {
  const { cfg, storage, authProvider } = deps;
  const broadcaster = deps.broadcaster ?? createBroadcaster();

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
  app.route("/api/auth", authProvider.router());
  app.route(
    "/api/notes",
    createNotesRoutes({
      storage,
      authProvider,
      broadcaster,
      rateLimit: apiRateLimit,
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

  return { app, broadcaster };
}
