import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createApp } from "./app.js";
import { createAuthProvider } from "./auth/index.js";
import {
  announceInitialAdmin,
  ensureInitialAdmin,
} from "./auth/initialAdmin.js";
import { loadConfig } from "./config.js";
import { startAttachmentCleanup } from "./lib/attachmentCleanup.js";
import { logger } from "./lib/logger.js";
import { createMetricsApp } from "./lib/metricsServer.js";
import { startScheduledBackup } from "./lib/scheduledBackup.js";
import { startSessionCleanup } from "./lib/sessionCleanup.js";
import { createShutdown } from "./lib/shutdown.js";
import { startTrashCleanup } from "./lib/trashCleanup.js";
import { startUpdateCheck } from "./lib/updateCheck.js";
import { createStorage } from "./storage/index.js";
import { VERSION } from "./version.js";
import { attachAppSocket } from "./ws/appSocket.js";
import { attachYjsSocket } from "./ws/yjsSocket.js";

const cfg = loadConfig();
const storage = await createStorage(cfg);
// Before the server listens, so no request can reach a server nobody can
// administer.
const initialAdmin = await ensureInitialAdmin(storage, cfg);
if (initialAdmin) announceInitialAdmin(initialAdmin);
const authProvider = createAuthProvider(cfg, storage);
const updateCheck = cfg.updateCheckRepo
  ? startUpdateCheck(cfg.updateCheckRepo, VERSION)
  : null;
const { app, broadcaster, revocations, accessChanges, noteEvents, webhooks } =
  createApp({
    cfg,
    storage,
    authProvider,
    logRequests: true,
    updateStatus: () => updateCheck?.status() ?? null,
  });

const ws = createNodeWebSocket({ app });
const stopAppSocket = attachAppSocket({
  app,
  ws,
  authProvider,
  broadcaster,
  revocations,
  accessChanges,
  storage,
  cfg,
});

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

// Metrics on a port of their own, which a deployment does not publish: a
// scraper on the same host or network reaches it, the internet does not.
const metricsServer = cfg.metricsPort
  ? (serve(
      {
        fetch: createMetricsApp(cfg, VERSION).fetch,
        port: cfg.metricsPort,
        hostname: cfg.metricsHost,
      },
      (info) => {
        logger.info("Metrics listening", {
          host: cfg.metricsHost,
          port: info.port,
        });
      },
    ) as unknown as HttpServer)
  : null;
const yjs = attachYjsSocket({
  httpServer: server,
  storage,
  authProvider,
  revocations,
  accessChanges,
  cfg,
});
const stopTrashCleanup = startTrashCleanup({
  storage,
  broadcaster,
  noteEvents,
});
const stopSessionCleanup = startSessionCleanup({
  storage,
  auditRetentionDays: cfg.auditRetentionDays,
});
const stopAttachmentCleanup = startAttachmentCleanup(storage);
const stopBackups = cfg.backup
  ? startScheduledBackup(storage, cfg.backup, cfg.dbPath)
  : () => {};

const shutdown = createShutdown({
  closeServer: () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  destroyRealtime: () => yjs.destroy(),
  // `close()` waits for open sockets and a collaboration socket is open by
  // design, so its callback only arrives once these are gone.
  dropConnections: () => server.closeAllConnections?.(),
  stopJobs: [
    stopTrashCleanup,
    stopSessionCleanup,
    stopAttachmentCleanup,
    stopBackups,
    stopAppSocket,
    () => webhooks?.stop(),
    () => updateCheck?.stop(),
    () => metricsServer?.close(),
  ],
  closeStorage: () => storage.close(),
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}
