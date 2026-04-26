import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { logger } from "./lib/logger.js";
import { attachAppSocket } from "./ws/appSocket.js";
import { attachYjsSocket } from "./ws/yjsSocket.js";

const cfg = loadConfig();
const db = openDatabase(cfg.dbPath);
const { app, usersRepo, sessionsRepo, notesRepo, broadcaster } = createApp({
  db,
  cfg,
});

const ws = createNodeWebSocket({ app });
attachAppSocket({ app, ws, sessionsRepo, usersRepo, broadcaster, cfg });

import type { Server as HttpServer } from "node:http";

const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  logger.info("Server listening", {
    port: info.port,
    dbPath: cfg.dbPath,
    corsOrigins: cfg.corsOrigins,
  });
}) as unknown as HttpServer;

ws.injectWebSocket(server);
attachYjsSocket({ httpServer: server, db, sessionsRepo, notesRepo, cfg });
