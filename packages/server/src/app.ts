import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { createAuthSharedRoutes } from "./auth/sharedRoutes.js";
import type { AuthProvider } from "./auth/types.js";
import type { ServerConfig } from "./config.js";
import { logger } from "./lib/logger.js";
import { corsMiddleware } from "./middleware/cors.js";
import { onError } from "./middleware/error.js";
import { createNotesRoutes } from "./routes/notes.js";
import { createSearchRoutes } from "./routes/search.js";
import type { StorageDriver } from "./storage/types.js";
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

  app.get("/api/health", (c) => c.json({ ok: true }));

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
