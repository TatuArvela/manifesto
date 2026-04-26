import type { NodeWebSocket } from "@hono/node-ws";
import type {
  PresenceUser,
  WebSocketClientEvent,
  WebSocketEvent,
} from "@manifesto/shared";
import type { Hono } from "hono";
import type { ServerConfig } from "../config.js";
import type { SessionsRepo } from "../db/repositories/sessions.js";
import type { UsersRepo } from "../db/repositories/users.js";
import { logger } from "../lib/logger.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import type { Broadcaster } from "./broadcaster.js";

export const SUBPROTOCOL = "manifesto-session";

interface Connection {
  id: string;
  userId: string;
  user: PresenceUser;
  send: (data: string) => void;
  viewedNoteId: string | null;
}

interface AppSocketDeps {
  app: Hono;
  ws: NodeWebSocket;
  sessionsRepo: SessionsRepo;
  usersRepo: UsersRepo;
  broadcaster: Broadcaster;
  cfg: ServerConfig;
}

export function attachAppSocket(deps: AppSocketDeps): void {
  const { app, ws, sessionsRepo, usersRepo, broadcaster, cfg } = deps;

  // Negotiate the subprotocol so browsers don't reject the handshake when they
  // sent `Sec-WebSocket-Protocol: manifesto-session, <token>`.
  ws.wss.options.handleProtocols = (protocols) => {
    return protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false;
  };

  const connectionsByUser = new Map<string, Set<Connection>>();
  // For each user, count how many of their connections are viewing each note.
  // We send presence:join when the count goes 0 -> 1 and presence:leave when
  // it goes 1 -> 0, so a user with three tabs on the same note shows up
  // exactly once in the avatar stack.
  const viewCountByUser = new Map<string, Map<string, number>>();
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

  broadcaster.subscribe((userId, event) => sendToOthers(userId, event));

  function viewCounts(userId: string): Map<string, number> {
    let m = viewCountByUser.get(userId);
    if (!m) {
      m = new Map();
      viewCountByUser.set(userId, m);
    }
    return m;
  }

  function setViewedNote(conn: Connection, noteId: string | null) {
    const previous = conn.viewedNoteId;
    if (previous === noteId) return;
    const counts = viewCounts(conn.userId);
    if (previous !== null) {
      const next = (counts.get(previous) ?? 1) - 1;
      if (next <= 0) {
        counts.delete(previous);
        sendToOthers(
          conn.userId,
          { type: "presence:leave", noteId: previous, userId: conn.userId },
          conn,
        );
      } else {
        counts.set(previous, next);
      }
    }
    conn.viewedNoteId = noteId;
    if (noteId !== null) {
      const next = (counts.get(noteId) ?? 0) + 1;
      counts.set(noteId, next);
      if (next === 1) {
        sendToOthers(
          conn.userId,
          { type: "presence:join", noteId, user: conn.user },
          conn,
        );
      }
    }
  }

  function isClientEvent(value: unknown): value is WebSocketClientEvent {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    if (v.type === "presence:update") {
      return typeof v.noteId === "string" || v.noteId === null;
    }
    if (v.type === "note:edit") {
      return typeof v.id === "string" && typeof v.changes === "object";
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
          const session = await sessionsRepo.findByToken(token);
          if (!session) {
            socket.close(4401, "Invalid session");
            return;
          }
          if (session.expires_at < nowIso()) {
            await sessionsRepo.deleteByToken(token);
            socket.close(4401, "Session expired");
            return;
          }
          const user = await usersRepo.findById(session.user_id);
          if (!user) {
            socket.close(4401, "User not found");
            return;
          }
          await sessionsRepo.touch(
            token,
            nowIso(),
            isoPlusDays(cfg.sessionTtlDays),
          );
          conn = {
            id: `c${++nextId}`,
            userId: session.user_id,
            user: {
              id: user.id,
              displayName: user.display_name || user.username,
              avatarColor: user.avatar_color,
            },
            send: (data) => socket.send(data),
            viewedNoteId: null,
          };
          register(conn);
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
            setViewedNote(
              conn,
              parsed.noteId === undefined ? null : parsed.noteId,
            );
          }
          // `note:edit` from clients is not handled in Phase 3 — REST is the
          // authoritative write path; the server fans out updates from REST.
        },

        onClose() {
          if (!conn) return;
          setViewedNote(conn, null);
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
}
