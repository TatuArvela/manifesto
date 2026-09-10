import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createApp } from "./app.js";
import { createAuthProvider } from "./auth/index.js";
import { loadConfig } from "./config.js";
import { logger } from "./lib/logger.js";
import { startSessionCleanup } from "./lib/sessionCleanup.js";
import { createShutdown } from "./lib/shutdown.js";
import { startTrashCleanup } from "./lib/trashCleanup.js";
import { createStorage } from "./storage/index.js";
import { VERSION } from "./version.js";
import { attachAppSocket } from "./ws/appSocket.js";
import { attachYjsSocket } from "./ws/yjsSocket.js";

const cfg = loadConfig();
const storage = await createStorage(cfg);
const authProvider = createAuthProvider(cfg, storage);
const { app, broadcaster } = createApp({ cfg, storage, authProvider });

const ws = createNodeWebSocket({ app });
attachAppSocket({ app, ws, authProvider, broadcaster, cfg });

const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  logger.info("Server listening", {
    version: VERSION,
    port: info.port,
    storageDriver: cfg.storageDriver,
    authProvider: cfg.authProvider,
    dbPath: cfg.dbPath,
    corsOrigins: cfg.corsOrigins,
  });
}) as unknown as HttpServer;

ws.injectWebSocket(server);
const yjs = attachYjsSocket({ httpServer: server, storage, authProvider, cfg });
const stopTrashCleanup = startTrashCleanup(storage, broadcaster);
const stopSessionCleanup = startSessionCleanup(storage);

const shutdown = createShutdown({
  closeServer: () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  destroyRealtime: () => yjs.destroy(),
  // `close()` waits for open sockets and a collaboration socket is open by
  // design, so its callback only arrives once these are gone.
  dropConnections: () => server.closeAllConnections?.(),
  stopJobs: [stopTrashCleanup, stopSessionCleanup],
  closeStorage: () => storage.close(),
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}
