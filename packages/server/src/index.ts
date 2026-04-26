import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createApp } from "./app.js";
import { createAuthProvider } from "./auth/index.js";
import { loadConfig } from "./config.js";
import { logger } from "./lib/logger.js";
import { startTrashCleanup } from "./lib/trashCleanup.js";
import { createStorage } from "./storage/index.js";
import { attachAppSocket } from "./ws/appSocket.js";
import { attachYjsSocket } from "./ws/yjsSocket.js";

const cfg = loadConfig();
const storage = createStorage(cfg);
const authProvider = createAuthProvider(cfg, storage);
const { app, broadcaster } = createApp({ cfg, storage, authProvider });

const ws = createNodeWebSocket({ app });
attachAppSocket({ app, ws, authProvider, broadcaster, cfg });

const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  logger.info("Server listening", {
    port: info.port,
    storageDriver: cfg.storageDriver,
    authProvider: cfg.authProvider,
    dbPath: cfg.dbPath,
    corsOrigins: cfg.corsOrigins,
  });
}) as unknown as HttpServer;

ws.injectWebSocket(server);
attachYjsSocket({ httpServer: server, storage, authProvider, cfg });
startTrashCleanup(storage, broadcaster);
