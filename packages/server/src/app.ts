import { Hono } from "hono";
import type { ServerConfig } from "./config.js";
import type { DB } from "./db/index.js";
import { createNotesRepo } from "./db/repositories/notes.js";
import { createSessionsRepo } from "./db/repositories/sessions.js";
import { createUsersRepo } from "./db/repositories/users.js";
import { corsMiddleware } from "./middleware/cors.js";
import { onError } from "./middleware/error.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createNotesRoutes } from "./routes/notes.js";
import { createSearchRoutes } from "./routes/search.js";
import { type Broadcaster, createBroadcaster } from "./ws/broadcaster.js";

export interface AppDeps {
  db: DB;
  cfg: ServerConfig;
  broadcaster?: Broadcaster;
}

export function createApp(deps: AppDeps) {
  const usersRepo = createUsersRepo(deps.db);
  const sessionsRepo = createSessionsRepo(deps.db);
  const notesRepo = createNotesRepo(deps.db);
  const broadcaster = deps.broadcaster ?? createBroadcaster();

  const app = new Hono();
  app.use("*", corsMiddleware(deps.cfg));
  app.onError(onError);

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.route(
    "/api/auth",
    createAuthRoutes({ usersRepo, sessionsRepo, cfg: deps.cfg }),
  );
  app.route(
    "/api/notes",
    createNotesRoutes({
      notesRepo,
      sessionsRepo,
      cfg: deps.cfg,
      broadcaster,
    }),
  );
  app.route(
    "/api/search",
    createSearchRoutes({ notesRepo, sessionsRepo, cfg: deps.cfg }),
  );

  return { app, usersRepo, sessionsRepo, notesRepo, broadcaster };
}

export type AppHandle = ReturnType<typeof createApp>;
