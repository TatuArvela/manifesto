import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createApp } from "./app.ts";
import { createAuthProvider } from "./auth/index.ts";
import {
  announceInitialAdmin,
  ensureInitialAdmin,
} from "./auth/initialAdmin.ts";
import { loadConfig } from "./config.ts";
import { isFeatureOn } from "./features.ts";
import { startAttachmentCleanup } from "./jobs/attachmentCleanup.ts";
import { startPushReminders } from "./jobs/pushReminders.ts";
import { startScheduledBackup } from "./jobs/scheduledBackup.ts";
import { startSessionCleanup } from "./jobs/sessionCleanup.ts";
import { startTrashCleanup } from "./jobs/trashCleanup.ts";
import { startUpdateCheck } from "./jobs/updateCheck.ts";
import { logger } from "./lib/logger.ts";
import { createMetricsApp } from "./lib/metricsServer.ts";
import { createShutdown } from "./lib/shutdown.ts";
import { createStorage } from "./storage/index.ts";
import { MigrationRefusedError } from "./storage/migrations.ts";
import { moveToCurrentKey } from "./storage/serverKey.ts";
import { VERSION } from "./version.ts";
import { attachAppSocket } from "./ws/appSocket.ts";
import { attachYjsSocket } from "./ws/yjsSocket.ts";

const cfg = loadConfig();
const storage = await createStorage(cfg).catch((err: unknown) => {
  // A database this version will not run on: said plainly, with no stack,
  // since nothing is wrong with the server.
  if (err instanceof MigrationRefusedError) {
    logger.error(err.message);
    process.exit(1);
  }
  throw err;
});
// What the server stores for itself goes under its current key: a value
// from before it had one, or under the key before, is rewritten.
await moveToCurrentKey(storage, cfg.dataEncryptionKeyPrevious !== null);
// Before the server listens, so no request can reach a server nobody can
// administer.
const initialAdmin = await ensureInitialAdmin(storage, cfg);
if (initialAdmin) announceInitialAdmin(initialAdmin);
const authProvider = createAuthProvider(cfg, storage);
const updateCheck = cfg.updateCheckRepo
  ? startUpdateCheck(cfg.updateCheckRepo, VERSION)
  : null;
const {
  app,
  broadcaster,
  revocations,
  accessChanges,
  noteEvents,
  webhooks,
  pushSender,
} = createApp({
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
  noteEvents,
});
const stopSessionCleanup = startSessionCleanup({
  storage,
  auditRetentionDays: cfg.auditRetentionDays,
});
const stopAttachmentCleanup = startAttachmentCleanup(storage);
const stopPushReminders = isFeatureOn(cfg, "pushReminders")
  ? startPushReminders({ storage, sender: pushSender, noteEvents })
  : () => {};
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
    stopPushReminders,
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
