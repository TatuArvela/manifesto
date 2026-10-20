import type { NodeWebSocket } from "@hono/node-ws";
import {
  APP_SOCKET_HEARTBEAT_MS,
  hasScope,
  type PresenceUser,
  type WebSocketClientEvent,
  type WebSocketEvent,
} from "@manifesto/shared";
import type { Hono } from "hono";
import type { SessionRevocations } from "#/auth/revocations.ts";
import type { AuthProvider } from "#/auth/types.ts";
import type { ServerConfig } from "#/config.ts";
import { logger } from "#/lib/logger.ts";
import { gaugeMetric } from "#/lib/metrics.ts";
import { hashToken } from "#/lib/token.ts";
import type { AccessChanges } from "#/sharing/accessChanges.ts";
import type { StorageDriver } from "#/storage/types.ts";
import type { Broadcaster } from "./broadcaster.ts";
import { recheckSockets, SOCKET_RECHECK_MS } from "./recheck.ts";

export const SUBPROTOCOL = "manifesto-session";

/**
 * The largest frame that `/api/v1/ws` reads. A client only tells which note it
 * looks at. Without a limit, `ws` assembles frames of up to 100 MiB in memory
 * before any code here sees them, for a peer that is not authenticated yet.
 */
export const APP_SOCKET_MAX_PAYLOAD = 16 * 1024;

interface Connection {
  id: string;
  userId: string;
  /** The bearer token with which the socket authenticated. */
  token: string;
  user: PresenceUser;
  send: (data: string) => void;
  close: (code: number, reason: string) => void;
  /** Send a protocol ping. The pong of the peer sets `alive`. */
  ping: () => void;
  /**
   * Drop the connection without a closing handshake, which a peer that went
   * away would never answer.
   */
  terminate: () => void;
  /** If the peer answered since the last ping. */
  alive: boolean;
  viewedNoteId: string | null;
  /**
   * Each `presence:update` increases it. Thus, an access check that completes
   * after a newer update arrived knows that it must drop its answer.
   */
  presenceSeq: number;
  closed: boolean;
}

interface AppSocketDeps {
  app: Hono;
  ws: NodeWebSocket;
  authProvider: AuthProvider;
  broadcaster: Broadcaster;
  revocations: SessionRevocations;
  accessChanges: AccessChanges;
  storage: StorageDriver;
  cfg: ServerConfig;
  /**
   * Tests make this shorter. All others use {@link APP_SOCKET_HEARTBEAT_MS}.
   */
  heartbeatMs?: number | undefined;
  /** Tests make this shorter. All others use {@link SOCKET_RECHECK_MS}. */
  recheckMs?: number | undefined;
}

/**
 * Connect `/api/v1/ws` to the app. Returns a function that stops its timers.
 */
export function attachAppSocket(deps: AppSocketDeps): () => void {
  const { app, ws, authProvider, broadcaster, revocations, storage } = deps;

  // Negotiate the subprotocol. Thus, browsers do not refuse the handshake when
  // they sent `Sec-WebSocket-Protocol: manifesto-session, <token>`.
  ws.wss.options.handleProtocols = (protocols) => {
    return protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false;
  };
  // Read at each upgrade. Thus, a value set here limits all sockets.
  ws.wss.options.maxPayload = APP_SOCKET_MAX_PAYLOAD;

  const connectionsByUser = new Map<string, Set<Connection>>();
  gaugeMetric("manifesto_app_sockets", "Open /api/v1/ws sockets.", () =>
    [...connectionsByUser.values()].reduce((n, set) => n + set.size, 0),
  );
  gaugeMetric(
    "manifesto_app_socket_users",
    "Accounts with at least one open /api/v1/ws socket.",
    () => connectionsByUser.size,
  );
  // For each note, how many connections of each user look at it. We send
  // presence:join when the count of a user goes 0 -> 1, and presence:leave when
  // it goes 1 -> 0. Thus, a user with three tabs on the same note shows exactly
  // one time in the avatar stack.
  const viewersByNote = new Map<string, Map<string, number>>();
  // Who gets the presence on a note: its owner and the people with whom it is
  // shared. Read when a person starts to look at it, and kept while any person
  // does.
  const audienceByNote = new Map<string, Set<string>>();
  let nextId = 0;

  function register(conn: Connection) {
    let set = connectionsByUser.get(conn.userId);
    if (!set) {
      set = new Set();
      connectionsByUser.set(conn.userId, set);
    }
    set.add(conn);
  }

  function unregister(conn: Connection) {
    const set = connectionsByUser.get(conn.userId);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) connectionsByUser.delete(conn.userId);
  }

  function sendToOthers(
    userId: string,
    event: WebSocketEvent,
    exclude?: Connection,
  ) {
    const set = connectionsByUser.get(userId);
    if (!set) return;
    const payload = JSON.stringify(event);
    for (const conn of set) {
      if (conn === exclude) continue;
      conn.send(payload);
    }
  }

  function sendToAudience(
    noteId: string,
    event: WebSocketEvent,
    exclude: Connection,
  ) {
    for (const userId of audienceByNote.get(noteId) ?? []) {
      sendToOthers(userId, event, exclude);
    }
  }

  broadcaster.subscribe((userId, event) => sendToOthers(userId, event));

  // A connection that disappears without a close (a phone that changes
  // networks, a laptop that sleeps, a NAT that forgets it) stays open at both
  // ends until TCP stops, which can take many minutes. In that time, its user
  // still shows on the note that they had open, and their client thinks that it
  // gets all events. The protocol ping finds such a peer here. A browser
  // answers it without the page. Thus, one interval without an answer means
  // that nobody is there. The termination runs `onClose`, as all other
  // departures do. The client cannot see protocol pings. Thus, it listens for
  // the `heartbeat` event.
  const heartbeat = JSON.stringify({ type: "heartbeat" });
  const heartbeatTimer = setInterval(() => {
    for (const set of [...connectionsByUser.values()]) {
      for (const conn of [...set]) {
        if (!conn.alive) {
          conn.terminate();
          continue;
        }
        conn.alive = false;
        conn.ping();
        conn.send(heartbeat);
      }
    }
  }, deps.heartbeatMs ?? APP_SOCKET_HEARTBEAT_MS);
  heartbeatTimer.unref();

  // A session or token that expired announces nothing (see `recheck.ts`).
  const recheckTimer = setInterval(() => {
    const open = [...connectionsByUser.values()].flatMap((set) =>
      [...set].map((conn) => ({ token: conn.token, socket: conn })),
    );
    void recheckSockets(authProvider, "notes:read", open, (conn) => {
      if (!conn.closed) conn.close(4401, "Session ended");
    });
  }, deps.recheckMs ?? SOCKET_RECHECK_MS);
  recheckTimer.unref();

  // A socket authenticates one time, at the handshake. Thus, the end of a
  // session must reach the sockets that it opened. The client already reads
  // 4401 as "signed out". `onClose` below unregisters each one.
  revocations.subscribe(({ userId, keepToken, onlyTokenHash }) => {
    const set = connectionsByUser.get(userId);
    if (!set) return;
    for (const conn of [...set]) {
      if (conn.token === keepToken) continue;
      if (onlyTokenHash && hashToken(conn.token) !== onlyTokenHash) continue;
      conn.close(4401, "Session ended");
    }
  });

  // A person who cannot see a note now stops to show on it, and stops to learn
  // who else is there. The loss of only the right to edit changes neither. A
  // person who just got access learns about it from now on, and learns
  // immediately who already looks at it. A note at which nobody looks needs
  // nothing. The code reads its audience again when a person opens it.
  deps.accessChanges.subscribe(({ noteId, userIds, change }) => {
    if (change === "lost-edit") return;
    if (change === "gained") {
      const audience = audienceByNote.get(noteId);
      if (!audience) return;
      for (const userId of userIds) {
        audience.add(userId);
        for (const conn of connectionsByUser.get(userId) ?? []) {
          tellWhoIsHere(conn, noteId);
        }
      }
      return;
    }
    for (const userId of userIds) {
      for (const conn of connectionsByUser.get(userId) ?? []) {
        if (conn.viewedNoteId === noteId) stopViewing(conn);
      }
      audienceByNote.get(noteId)?.delete(userId);
    }
  });

  function stopViewing(conn: Connection) {
    const noteId = conn.viewedNoteId;
    if (noteId === null) return;
    conn.viewedNoteId = null;
    const counts = viewersByNote.get(noteId);
    const next = (counts?.get(conn.userId) ?? 1) - 1;
    if (counts && next > 0) {
      counts.set(conn.userId, next);
      return;
    }
    sendToAudience(
      noteId,
      { type: "presence:leave", noteId, userId: conn.userId },
      conn,
    );
    counts?.delete(conn.userId);
    if (!counts || counts.size === 0) {
      viewersByNote.delete(noteId);
      audienceByNote.delete(noteId);
    }
  }

  /**
   * Send `conn` a join for each other person who looks at the note, if its user
   * is one of the people who can know. The own user of a connection is not
   * included. Its other tabs never announced themselves to it, and still do
   * not.
   */
  function tellWhoIsHere(conn: Connection, noteId: string) {
    const counts = viewersByNote.get(noteId);
    if (!counts || !audienceByNote.get(noteId)?.has(conn.userId)) return;
    for (const userId of counts.keys()) {
      if (userId === conn.userId) continue;
      const other = connectionsByUser.get(userId)?.values().next().value;
      if (!other) continue;
      conn.send(
        JSON.stringify({ type: "presence:join", noteId, user: other.user }),
      );
    }
  }

  function startViewing(conn: Connection, noteId: string, audience: string[]) {
    conn.viewedNoteId = noteId;
    audienceByNote.set(noteId, new Set(audience));
    let counts = viewersByNote.get(noteId);
    if (!counts) {
      counts = new Map();
      viewersByNote.set(noteId, counts);
    }
    const next = (counts.get(conn.userId) ?? 0) + 1;
    counts.set(conn.userId, next);
    if (next !== 1) return;
    sendToAudience(
      noteId,
      { type: "presence:join", noteId, user: conn.user },
      conn,
    );
    // The persons who are already here. Thus, the new person does not have to
    // wait until they leave and come back to know it.
    tellWhoIsHere(conn, noteId);
  }

  /** All persons who can see the note, if `userId` is one of them. */
  async function audienceOf(
    noteId: string,
    userId: string,
  ): Promise<string[] | null> {
    const audience = await storage.shares.audience(noteId);
    if (!audience) return null;
    const accepted = audience.trashed
      ? []
      : audience.shares
          .filter((share) => share.acceptedAt !== null)
          .map((share) => share.userId);
    const everyone = [audience.ownerId, ...accepted];
    return everyone.includes(userId) ? everyone : null;
  }

  async function setViewedNote(conn: Connection, noteId: string | null) {
    const seq = ++conn.presenceSeq;
    if (conn.viewedNoteId === noteId) return;
    stopViewing(conn);
    if (noteId === null) return;
    // The code does not trust a note id. Presence tells who looks at what, and
    // a note shared with nobody concerns no other person.
    const audience = await audienceOf(noteId, conn.userId);
    if (conn.closed || seq !== conn.presenceSeq || audience === null) return;
    startViewing(conn, noteId, audience);
  }

  function isClientEvent(value: unknown): value is WebSocketClientEvent {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    if (v.type === "presence:update") {
      return typeof v.noteId === "string" || v.noteId === null;
    }
    if (v.type === "note:edit") {
      return (
        typeof v.id === "string" &&
        typeof v.changes === "object" &&
        v.changes !== null
      );
    }
    return false;
  }

  app.get(
    "/api/v1/ws",
    ws.upgradeWebSocket((c) => {
      const protocols = c.req.header("Sec-WebSocket-Protocol") ?? "";
      const parts = protocols
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      const tokenIndex = parts.indexOf(SUBPROTOCOL) + 1;
      const token = tokenIndex > 0 ? parts[tokenIndex] : undefined;

      if (!token) {
        return {
          onOpen(_evt, socket) {
            socket.close(4401, "Missing token");
          },
        };
      }

      let conn: Connection | null = null;

      return {
        async onOpen(_evt, socket) {
          const identity = await authProvider.authenticate(token);
          // An MCP token is only for `/api/v1/mcp`, and a socket carries notes.
          if (
            !identity ||
            identity.via === "mcp-token" ||
            (identity.scopes && !hasScope(identity.scopes, "notes:read"))
          ) {
            socket.close(4401, "Invalid or expired session");
            return;
          }
          conn = {
            id: `c${++nextId}`,
            userId: identity.userId,
            token,
            user: {
              id: identity.userId,
              displayName: identity.displayName,
              avatarColor: identity.avatarColor,
            },
            send: (data) => socket.send(data),
            close: (code, reason) => socket.close(code, reason),
            ping: () => socket.raw?.ping(),
            terminate: () => socket.raw?.terminate(),
            alive: true,
            viewedNoteId: null,
            presenceSeq: 0,
            closed: false,
          };
          const live = conn;
          socket.raw?.on("pong", () => {
            live.alive = true;
          });
          register(conn);
          // A socket that opens (a new tab, a reload, a reconnect) missed all
          // joins sent before it. Thus, it learns who is on the notes that its
          // user can see.
          for (const noteId of viewersByNote.keys()) {
            tellWhoIsHere(conn, noteId);
          }
        },

        onMessage(evt) {
          if (!conn) return;
          const raw = typeof evt.data === "string" ? evt.data : null;
          if (!raw) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            return;
          }
          if (!isClientEvent(parsed)) return;
          if (parsed.type === "presence:update") {
            void setViewedNote(conn, parsed.noteId).catch((err) => {
              logger.warn("Presence update failed", {
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }
          // Phase 3 does not handle `note:edit` from clients. REST is the
          // authoritative write path, and the server sends updates from REST.
        },

        onClose() {
          if (!conn) return;
          conn.closed = true;
          conn.presenceSeq++;
          stopViewing(conn);
          unregister(conn);
          conn = null;
        },

        onError(err) {
          logger.warn("WebSocket error", {
            error: err instanceof Error ? err.message : String(err),
          });
        },
      };
    }),
  );

  return () => {
    clearInterval(heartbeatTimer);
    clearInterval(recheckTimer);
  };
}
