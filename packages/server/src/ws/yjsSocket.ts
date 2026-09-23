import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus } from "@hocuspocus/server";
import type { RawData, WebSocket } from "ws";
import { WebSocketServer } from "ws";
import type { SessionRevocations } from "../auth/revocations.js";
import type { AuthProvider } from "../auth/types.js";
import type { ServerConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import { hashToken } from "../lib/token.js";
import type { AccessChanges } from "../sharing/accessChanges.js";
import type { StorageDriver } from "../storage/types.js";
import {
  type YjsAuthContext,
  YjsPersistenceExtension,
} from "./yjsExtension.js";

/**
 * Single endpoint for every note. Hocuspocus multiplexes documents over one
 * socket by name, so the note id travels in the protocol rather than the path.
 */
export const YJS_PATH = "/api/yjs";

interface AttachOptions {
  httpServer: HttpServer;
  storage: StorageDriver;
  authProvider: AuthProvider;
  revocations: SessionRevocations;
  accessChanges: AccessChanges;
  cfg: ServerConfig;
}

export interface YjsSocket {
  hocuspocus: Hocuspocus<YjsAuthContext>;
  destroy: () => Promise<void>;
}

export function attachYjsSocket(opts: AttachOptions): YjsSocket {
  const { httpServer, storage, authProvider, revocations, accessChanges } =
    opts;

  const hocuspocus = new Hocuspocus<YjsAuthContext>();
  hocuspocus.configure({
    name: "manifesto-yjs",
    quiet: true,
    extensions: [new YjsPersistenceExtension(storage.yjs)],
    debounce: 2000,
    maxDebounce: 10_000,

    /**
     * Authorization must happen here, not at the HTTP upgrade.
     *
     * Hocuspocus reads the document name from the first varString of every
     * incoming frame and keys its process-global document map on that; it
     * never looks at the URL. Checking a note id parsed from the path would
     * therefore authorize one document while the client joined another, so a
     * user cleared for their own note could address frames at someone else's
     * live Y.Doc. `documentName` here is the value actually used to find the
     * room, which makes the check binding.
     *
     * Throwing rejects the connection with a permission-denied message before
     * any document is created or joined.
     *
     * The live document is the note's text, so joining it is writing it: the
     * owner and people it is shared with to edit may, and someone who can only
     * view it may not. A viewer reads the note as REST writes and `note:updated`
     * events bring it, and never needs the room.
     */
    onAuthenticate: async ({ token, documentName }) => {
      const identity = await authProvider.authenticate(token);
      if (!identity) throw new Error("Invalid or expired session");

      const access = await storage.notes.access(documentName, identity.userId);
      if (!access || access.role === "view") throw new Error("Forbidden");

      return {
        userId: identity.userId,
        noteId: documentName,
        ownerId: access.ownerId,
        token,
      } satisfies YjsAuthContext;
    },
  });

  // Close the whole socket rather than the one document's connection. A
  // socket carries every note a tab has open under one token, and closing a
  // document connection alone sends a close message the peer is free to
  // ignore. The provider reconnects, and `onAuthenticate` refuses the ended
  // session.
  const stopRevocations = revocations.subscribe(
    ({ userId, keepToken, onlyTokenHash }) => {
      for (const document of hocuspocus.documents.values()) {
        for (const connection of document.getConnections()) {
          const context = connection.context as YjsAuthContext | undefined;
          if (context?.userId !== userId || context.token === keepToken) {
            continue;
          }
          if (onlyTokenHash && hashToken(context.token) !== onlyTokenHash) {
            continue;
          }
          connection.webSocket.close(4401, "Session ended");
        }
      }
    },
  );

  // Losing a note, or the right to edit it, ends the connections to its
  // document. The whole socket, for the reason above: the provider
  // reconnects, rejoins the notes still allowed, and is refused this one.
  const stopAccessChanges = accessChanges.subscribe(
    ({ noteId, userIds, change }) => {
      if (change === "gained") return;
      const document = hocuspocus.documents.get(noteId);
      if (!document) return;
      for (const connection of document.getConnections()) {
        const context = connection.context as YjsAuthContext | undefined;
        if (!context || !userIds.includes(context.userId)) continue;
        connection.webSocket.close(4403, "Access changed");
      }
    },
  );

  const wss = new WebSocketServer({ noServer: true });

  // Capture and replace existing upgrade listeners so that WS requests targeting
  // `/api/yjs` go to Hocuspocus while everything else (including the
  // application JSON socket at /api/ws) continues to flow through the listeners
  // already registered (e.g. by `@hono/node-ws`).
  const previousListeners = httpServer.listeners("upgrade").slice() as Array<
    (req: IncomingMessage, socket: Duplex, head: Buffer) => void
  >;
  httpServer.removeAllListeners("upgrade");

  httpServer.on("upgrade", (request, socket, head) => {
    // Node removes its own socket error listener before emitting `upgrade`, and
    // `wss.handleUpgrade` is what attaches the next one. Anything in between is
    // unguarded, so a peer that resets the connection there would raise an
    // uncaught exception and take the process down. Keep this first.
    socket.on("error", () => {});

    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    if (url.pathname !== YJS_PATH) {
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

    wss.handleUpgrade(request, socket, head, (ws) => {
      bindConnection(hocuspocus, ws, nodeToWebRequest(request));
    });
  });

  return {
    hocuspocus,
    destroy: async () => {
      // Hocuspocus debounces persistence (2s, 10s max). Drain pending writes
      // and close active connections before tearing down the WebSocket server
      // so in-flight Yjs updates aren't lost on shutdown.
      stopRevocations();
      stopAccessChanges();
      await hocuspocus.flushPendingStores();
      hocuspocus.closeConnections();
      wss.close();
    },
  };
}

/**
 * Hocuspocus does not read from the socket itself: `WebSocketLike` is only
 * `send`/`close`/`readyState`, and `handleConnection` hands back a
 * `ClientConnection` whose `handleMessage` the integrator is expected to feed.
 * Without this wiring the server accepts the upgrade and then ignores every
 * frame, so no document is ever created and no hook (including
 * `onAuthenticate`) ever runs.
 */
function bindConnection(
  hocuspocus: Hocuspocus<YjsAuthContext>,
  ws: WebSocket,
  request: Request,
): void {
  const connection = hocuspocus.handleConnection(ws, request);

  ws.on("message", (data: RawData, isBinary: boolean) => {
    if (!isBinary) return;
    connection.handleMessage(toUint8Array(data));
  });

  ws.on("close", (code: number, reason: Buffer) => {
    connection.handleClose({
      code,
      reason: reason.toString(),
    } as CloseEvent);
  });

  // Post-upgrade socket errors surface as a close; swallow so they do not
  // reach the process as an unhandled 'error' event.
  ws.on("error", () => {});
}

function toUint8Array(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (Array.isArray(data)) {
    const joined = Buffer.concat(data);
    return new Uint8Array(joined.buffer, joined.byteOffset, joined.byteLength);
  }
  return new Uint8Array(data);
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
