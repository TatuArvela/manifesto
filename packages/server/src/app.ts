import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { logger as honoLogger } from "hono/logger";
import { createAuthSharedRoutes } from "./auth/sharedRoutes.js";
import type { AuthProvider } from "./auth/types.js";
import type { ServerConfig } from "./config.js";
import { logger } from "./lib/logger.js";
import { corsMiddleware } from "./middleware/cors.js";
import { HttpError, onError } from "./middleware/error.js";
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
    app.use(
      "*",
      honoLogger((message) => logger.info(message)),
    );
  }
  app.onError(onError);

  // Cap request bodies on /api/* to a sane note size. Without this, an
  // authenticated user could POST a multi-MB JSON body and exhaust server
  // memory. The 1 MiB cap is generous for note content; uploads outside
  // this envelope (images, attachments) will need their own ingestion path.
  const NOTE_BODY_LIMIT = 1024 * 1024;
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: NOTE_BODY_LIMIT,
      onError: () => {
        throw new HttpError(413, "Request body too large");
      },
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true, version: VERSION }));

  // Provider-agnostic auth routes (/methods, /me) must be registered BEFORE
  // the provider's own router so Hono's longest-prefix matching reaches them.
  app.route(
    "/api/auth",
    createAuthSharedRoutes({ cfg, storage, authProvider }),
  );
  app.route("/api/auth", authProvider.router());
  app.route(
    "/api/notes",
    createNotesRoutes({ storage, authProvider, cfg, broadcaster }),
  );
  app.route("/api/search", createSearchRoutes({ storage, authProvider, cfg }));

  return { app, broadcaster };
}
