import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus } from "@hocuspocus/server";
import { WebSocketServer } from "ws";
import type { ServerConfig } from "../config.js";
import type { DB } from "../db/index.js";
import type { NotesRepo } from "../db/repositories/notes.js";
import type { SessionsRepo } from "../db/repositories/sessions.js";
import { logger } from "../lib/logger.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import { SUBPROTOCOL } from "./appSocket.js";
import { SqliteYjsStore, type YjsAuthContext } from "./sqliteYjsStore.js";

export const YJS_PATH_PREFIX = "/api/yjs/notes/";

interface AttachOptions {
  httpServer: HttpServer;
  db: DB;
  sessionsRepo: SessionsRepo;
  notesRepo: NotesRepo;
  cfg: ServerConfig;
}

export interface YjsSocket {
  hocuspocus: Hocuspocus<YjsAuthContext>;
  destroy: () => Promise<void>;
}

export function attachYjsSocket(opts: AttachOptions): YjsSocket {
  const { httpServer, db, sessionsRepo, notesRepo, cfg } = opts;

  const hocuspocus = new Hocuspocus<YjsAuthContext>();
  hocuspocus.configure({
    name: "manifesto-yjs",
    quiet: true,
    extensions: [new SqliteYjsStore(db)],
    debounce: 2000,
    maxDebounce: 10_000,
  });

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) =>
      protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false,
  });

  // Capture and replace existing upgrade listeners so that WS requests targeting
  // `/api/yjs/notes/<id>` go to Hocuspocus while everything else (including the
  // application JSON socket at /api/ws) continues to flow through the listeners
  // already registered (e.g. by `@hono/node-ws`).
  const previousListeners = httpServer.listeners("upgrade").slice() as Array<
    (req: IncomingMessage, socket: Duplex, head: Buffer) => void
  >;
  httpServer.removeAllListeners("upgrade");

  httpServer.on("upgrade", async (request, socket, head) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (!url.pathname.startsWith(YJS_PATH_PREFIX)) {
      for (const listener of previousListeners) {
        try {
          listener(request, socket, head);
        } catch (err) {
          logger.warn("upgrade listener threw", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return;
    }

    const noteId = url.pathname.slice(YJS_PATH_PREFIX.length);
    if (!noteId) {
      reject(socket, 400, "Missing note id");
      return;
    }

    const protocols = parseProtocols(request.headers["sec-websocket-protocol"]);
    const tokenIdx = protocols.indexOf(SUBPROTOCOL) + 1;
    const token = tokenIdx > 0 ? protocols[tokenIdx] : "";
    if (!token) {
      reject(socket, 401, "Missing token");
      return;
    }

    try {
      const session = await sessionsRepo.findByToken(token);
      if (!session) return reject(socket, 401, "Invalid session");
      if (session.expires_at < nowIso()) {
        await sessionsRepo.deleteByToken(token);
        return reject(socket, 401, "Session expired");
      }
      const note = await notesRepo.getById(noteId, session.user_id);
      if (!note) return reject(socket, 403, "Forbidden");
      await sessionsRepo.touch(
        token,
        nowIso(),
        isoPlusDays(cfg.sessionTtlDays),
      );

      wss.handleUpgrade(request, socket, head, (ws) => {
        const webRequest = nodeToWebRequest(request);
        hocuspocus.handleConnection(ws, webRequest, {
          userId: session.user_id,
          noteId,
        });
      });
    } catch (err) {
      logger.error("Yjs upgrade failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      reject(socket, 500, "Server error");
    }
  });

  return {
    hocuspocus,
    destroy: async () => {
      wss.close();
    },
  };
}

function parseProtocols(header: string | string[] | undefined): string[] {
  if (!header) return [];
  const raw = Array.isArray(header) ? header.join(",") : header;
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function reject(socket: Duplex, status: number, reason: string) {
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function nodeToWebRequest(req: IncomingMessage): Request {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return new Request(url, { method: req.method, headers });
}
