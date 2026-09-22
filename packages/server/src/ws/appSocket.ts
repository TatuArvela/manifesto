import type { NodeWebSocket } from "@hono/node-ws";
import {
  APP_SOCKET_HEARTBEAT_MS,
  type PresenceUser,
  type WebSocketClientEvent,
  type WebSocketEvent,
} from "@manifesto/shared";
import type { Hono } from "hono";
import type { SessionRevocations } from "../auth/revocations.js";
import type { AuthProvider } from "../auth/types.js";
import type { ServerConfig } from "../config.js";
import { logger } from "../lib/logger.js";
import type { AccessChanges } from "../sharing/accessChanges.js";
import type { StorageDriver } from "../storage/types.js";
import type { Broadcaster } from "./broadcaster.js";

export const SUBPROTOCOL = "manifesto-session";

interface Connection {
  id: string;
  userId: string;
  /** The bearer token the socket authenticated with. */
  token: string;
  user: PresenceUser;
  send: (data: string) => void;
  close: (code: number, reason: string) => void;
  /** Send a protocol ping; the peer's pong sets `alive`. */
  ping: () => void;
  /** Drop the connection without a closing handshake, which a peer that has
   * gone away would never answer. */
  terminate: () => void;
  /** Whether the peer has answered since the last ping. */
  alive: boolean;
  viewedNoteId: string | null;
  /** Bumped by every `presence:update`, so an access check that finishes
   * after a newer update has arrived knows to drop its answer. */
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
  /** Tests shorten this; everyone else uses {@link APP_SOCKET_HEARTBEAT_MS}. */
  heartbeatMs?: number;
}

/** Wire `/api/ws` onto the app. Returns a function that stops the heartbeat. */
export function attachAppSocket(deps: AppSocketDeps): () => void {
  const { app, ws, authProvider, broadcaster, revocations, storage } = deps;

  // Negotiate the subprotocol so browsers don't reject the handshake when they
  // sent `Sec-WebSocket-Protocol: manifesto-session, <token>`.
  ws.wss.options.handleProtocols = (protocols) => {
    return protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false;
  };

  const connectionsByUser = new Map<string, Set<Connection>>();
  // For each note, how many of each user's connections are viewing it. We
  // send presence:join when a user's count goes 0 -> 1 and presence:leave when
  // it goes 1 -> 0, so a user with three tabs on the same note shows up
  // exactly once in the avatar stack.
  const viewersByNote = new Map<string, Map<string, number>>();
  // Who hears about presence on a note: its owner and the people it is shared
  // with. Read when someone starts viewing it, and kept while anyone is.
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

  // A connection that vanishes without a close (a phone changing networks, a
  // laptop asleep, a NAT forgetting it) stays open to both ends until TCP gives
  // up, which can take many minutes. Meanwhile its user is still shown on the
  // note they had open, and their client believes it is hearing everything.
  // The protocol ping finds such a peer here: a browser answers it without the
  // page taking part, so one unanswered interval means nobody is there, and
  // terminating it runs `onClose` like any other departure. The client cannot
  // see protocol pings, so the `heartbeat` event is what it listens for.
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

  // A socket is authenticated once, at the handshake, so ending a session
  // has to reach the sockets it opened. 4401 is what the client already reads
  // as "signed out"; `onClose` below unregisters each one.
  revocations.subscribe(({ userId, keepToken }) => {
    const set = connectionsByUser.get(userId);
    if (!set) return;
    for (const conn of [...set]) {
      if (conn.token === keepToken) continue;
      conn.close(4401, "Session ended");
    }
  });

  // Someone who can no longer see a note stops being shown on it, and stops
  // hearing who else is. Losing only the right to edit changes neither.
  // Someone who has just been let in hears about it from now on, and is told
  // at once who is already looking at it. A note nobody is looking at needs
  // nothing: its audience is read afresh when someone opens it.
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
   * Send `conn` a join for everyone else viewing the note, if its user is
   * among the people who may know. A connection's own user is left out: its
   * other tabs never announced themselves to it, and still do not.
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
    // Whoever else is already here, so the newcomer does not have to wait for
    // them to leave and come back to know it.
    tellWhoIsHere(conn, noteId);
  }

  /** Everyone who can see the note, if `userId` is one of them. */
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
    // A note id is not taken on trust: presence says who is looking at what,
    // and a note shared with nobody is nobody else's business.
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
    "/api/ws",
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
          if (!identity) {
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
          // A socket that opens (a new tab, a reload, a reconnect) missed
          // every join sent before it, so it learns who is on the notes its
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
          // `note:edit` from clients is not handled in Phase 3; REST is the
          // authoritative write path; the server fans out updates from REST.
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

  return () => clearInterval(heartbeatTimer);
}
