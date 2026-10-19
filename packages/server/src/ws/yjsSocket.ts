import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus } from "@hocuspocus/server";
import {
  EDITOR_OUTDATED_REASON,
  EDITOR_SCHEMA_VERSION,
  hasScope,
} from "@manifesto/shared";
import type { RawData, WebSocket } from "ws";
import { WebSocketServer } from "ws";
import type { SessionRevocations } from "#/auth/revocations.ts";
import type { AuthProvider } from "#/auth/types.ts";
import type { ServerConfig } from "#/config.ts";
import { logger } from "#/lib/logger.ts";
import { gaugeMetric } from "#/lib/metrics.ts";
import { hashToken } from "#/lib/token.ts";
import type { AccessChanges } from "#/sharing/accessChanges.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { recheckSockets, SOCKET_RECHECK_MS } from "./recheck.ts";
import {
  MAX_YJS_BYTES,
  type YjsAuthContext,
  YjsPersistenceExtension,
} from "./yjsExtension.ts";

/**
 * One endpoint for all notes. Hocuspocus sends documents over one socket by
 * name. Thus, the note id is in the protocol, not in the path.
 */
export const YJS_PATH = "/api/v1/yjs";

/** The part of the socket of a connection that its close needs. */
interface WebSocketLike {
  close(code?: number, reason?: string): void;
}

interface AttachOptions {
  httpServer: HttpServer;
  storage: StorageDriver;
  authProvider: AuthProvider;
  revocations: SessionRevocations;
  accessChanges: AccessChanges;
  cfg: ServerConfig;
  /** Tests make this shorter. All others use {@link SOCKET_RECHECK_MS}. */
  recheckMs?: number | undefined;
}

export interface YjsSocket {
  hocuspocus: Hocuspocus<YjsAuthContext>;
  destroy: () => Promise<void>;
}

export function attachYjsSocket(opts: AttachOptions): YjsSocket {
  const { httpServer, storage, authProvider, revocations, accessChanges } =
    opts;

  const hocuspocus = new Hocuspocus<YjsAuthContext>();
  gaugeMetric(
    "manifesto_yjs_documents_open",
    "Notes open for collaborative editing.",
    () => hocuspocus.getDocumentsCount(),
  );
  gaugeMetric(
    "manifesto_yjs_connections",
    "Connections to collaborative editing.",
    () => hocuspocus.getConnectionsCount(),
  );
  hocuspocus.configure({
    name: "manifesto-yjs",
    quiet: true,
    extensions: [new YjsPersistenceExtension(storage.yjs)],
    debounce: 2000,
    maxDebounce: 10_000,

    /**
     * Authorization must occur here, not at the HTTP upgrade.
     *
     * Hocuspocus reads the document name from the first varString of each
     * incoming frame, and uses it as the key of its document map for the
     * process. It never looks at the URL. Thus, a check of a note id from the
     * path would authorize one document while the client joined a different
     * one. A user with access to their own note could then send frames to the
     * live Y.Doc of a different person. `documentName` here is the value that
     * really finds the room. This makes the check binding.
     *
     * A throw refuses the connection with a permission-denied message, before a
     * document is created or joined.
     *
     * The live document is the text of the note. Thus, to join it is to write
     * it. The owner and the people who have the note shared with them to edit
     * can join. A person who can only view it cannot. A viewer reads the note
     * as REST writes and `note:updated` events bring it, and never needs the
     * room.
     *
     * An editor older than that of this server is refused first, with a reason
     * that the client changes into "reload to keep editing". It would remove
     * the nodes for which it has no schema, and write the loss back into the
     * copies of all persons.
     */
    onAuthenticate: async ({ token, documentName, requestParameters }) => {
      if (!editorIsCurrent(requestParameters.get("editor"))) {
        // Hocuspocus sends the `reason` of a thrown value as the refusal.
        throw Object.assign(new Error("Editor outdated"), {
          reason: EDITOR_OUTDATED_REASON,
        });
      }

      const identity = await authProvider.authenticate(token);
      // An MCP token is only for `/api/v1/mcp`, and to join a note is to write
      // it.
      if (
        !identity ||
        identity.via === "mcp-token" ||
        (identity.scopes && !hasScope(identity.scopes, "notes:write"))
      ) {
        throw new Error("Invalid or expired session");
      }

      const access = await storage.notes.access(documentName, identity.userId);
      if (!access || access.role === "view") throw new Error("Forbidden");

      return {
        userId: identity.userId,
        noteId: documentName,
        ownerId: access.ownerId,
        token,
        user: {
          id: identity.userId,
          name: identity.displayName,
          color: identity.avatarColor,
        },
      } satisfies YjsAuthContext;
    },

    /**
     * The name and color at a remote cursor come from the account, not from the
     * client. Each connection publishes its own client ids, and Hocuspocus
     * records the ids that it added. The code drops a state for an id that a
     * different connection has, because its publication would overwrite the
     * cursor of that peer. The remaining states belong to this connection, and
     * their `user` is replaced with the authenticated user. The color goes into
     * the inline style of the cursor. Thus, it must also not be text from the
     * client.
     *
     * An honest provider only sends its own id. It does not send back updates
     * that it applied from the server.
     */
    beforeHandleAwareness: async ({
      states,
      context,
      document,
      connection,
    }) => {
      if (!context || !connection) return;
      for (const [clientId, state] of states) {
        const heldElsewhere = document
          .getConnections()
          .some(
            (other) =>
              other !== connection && document.getClients(other).has(clientId),
          );
        if (heldElsewhere) {
          states.delete(clientId);
          continue;
        }
        state.user = { ...context.user };
      }
    },
  });

  // Close the full socket, not only the connection of the document. A socket
  // carries all notes that a tab has open under one token. A close of only the
  // connection of a document sends a close message that the peer can ignore.
  // The provider reconnects, and `onAuthenticate` refuses the ended session.
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

  // The loss of a note, or of the right to edit it, ends the connections to its
  // document. The full socket, for the reason above. The provider reconnects,
  // joins again the notes that are still permitted, and is refused this one.
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

  // A session or token that expired announces nothing (see `recheck.ts`). Again
  // the full socket, one time for each, however many notes it has open.
  const recheckTimer = setInterval(() => {
    const open = new Map<object, { token: string; socket: WebSocketLike }>();
    for (const document of hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        const context = connection.context as YjsAuthContext | undefined;
        if (!context) continue;
        open.set(connection.webSocket, {
          token: context.token,
          socket: connection.webSocket,
        });
      }
    }
    void recheckSockets(authProvider, "notes:write", open.values(), (socket) =>
      socket.close(4401, "Session ended"),
    );
  }, opts.recheckMs ?? SOCKET_RECHECK_MS);
  recheckTimer.unref();

  // Limited. If not, `ws` assembles frames of up to 100 MiB in memory before
  // Hocuspocus, and thus before `onAuthenticate`, sees any of them. A frame
  // carries a maximum of the full state of one document.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_YJS_BYTES,
  });

  // Capture and replace the existing upgrade listeners. Thus, WS requests to
  // `/api/v1/yjs` go to Hocuspocus, and all others (also the application JSON
  // socket at /api/v1/ws) continue through the listeners that are already
  // registered (for example, by `@hono/node-ws`).
  const previousListeners = httpServer.listeners("upgrade").slice() as Array<
    (req: IncomingMessage, socket: Duplex, head: Buffer) => void
  >;
  httpServer.removeAllListeners("upgrade");

  httpServer.on("upgrade", (request, socket, head) => {
    // Node removes its own socket error listener before it emits `upgrade`, and
    // `wss.handleUpgrade` attaches the next one. Nothing protects the time
    // between them. Thus, a peer that resets the connection there would cause
    // an uncaught exception, and stop the process. Keep this first.
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
      clearInterval(recheckTimer);
      await hocuspocus.flushPendingStores();
      hocuspocus.closeConnections();
      wss.close();
    },
  };
}

/**
 * Whether an editor may join, from the version it sent. A client from before
 * the check sends none and writes version 1; anything unreadable is refused,
 * since it cannot be shown to be current.
 */
export function editorIsCurrent(sent: string | null): boolean {
  if (sent === null) return EDITOR_SCHEMA_VERSION <= 1;
  if (!/^\d{1,6}$/.test(sent)) return false;
  return Number(sent) >= EDITOR_SCHEMA_VERSION;
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
  return new Request(url, { method: req.method ?? "GET", headers });
}
