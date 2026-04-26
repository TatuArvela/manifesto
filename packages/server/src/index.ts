import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { logger } from "./lib/logger.js";
import { attachAppSocket } from "./ws/appSocket.js";

const cfg = loadConfig();
const db = openDatabase(cfg.dbPath);
const { app, sessionsRepo, broadcaster } = createApp({ db, cfg });

const ws = createNodeWebSocket({ app });
attachAppSocket({ app, ws, sessionsRepo, broadcaster, cfg });

const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  logger.info("Server listening", {
    port: info.port,
    dbPath: cfg.dbPath,
    corsOrigins: cfg.corsOrigins,
  });
});

ws.injectWebSocket(server);
