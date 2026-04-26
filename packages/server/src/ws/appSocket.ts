import type { NodeWebSocket } from "@hono/node-ws";
import type { WebSocketClientEvent, WebSocketEvent } from "@manifesto/shared";
import type { Hono } from "hono";
import type { ServerConfig } from "../config.js";
import type { SessionsRepo } from "../db/repositories/sessions.js";
import { logger } from "../lib/logger.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import type { Broadcaster } from "./broadcaster.js";

export const SUBPROTOCOL = "manifesto-session";

interface Connection {
  id: string;
  userId: string;
  send: (data: string) => void;
  viewedNoteId: string | null;
}

interface AppSocketDeps {
  app: Hono;
  ws: NodeWebSocket;
  sessionsRepo: SessionsRepo;
  broadcaster: Broadcaster;
  cfg: ServerConfig;
}

export function attachAppSocket(deps: AppSocketDeps): void {
  const { app, ws, sessionsRepo, broadcaster, cfg } = deps;

  // Negotiate the subprotocol so browsers don't reject the handshake when they
  // sent `Sec-WebSocket-Protocol: manifesto-session, <token>`.
  ws.wss.options.handleProtocols = (protocols) => {
    return protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false;
  };

  const connectionsByUser = new Map<string, Set<Connection>>();
  const presenceByUser = new Map<
    string,
    Map<string /* noteId */, Set<string /* userId */>>
  >();
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

  function sendTo(userId: string, event: WebSocketEvent) {
    const set = connectionsByUser.get(userId);
    if (!set) return;
    const payload = JSON.stringify(event);
    for (const conn of set) conn.send(payload);
  }

  broadcaster.subscribe((userId, event) => sendTo(userId, event));

  function presenceMap(userId: string): Map<string, Set<string>> {
    let m = presenceByUser.get(userId);
    if (!m) {
      m = new Map();
      presenceByUser.set(userId, m);
    }
    return m;
  }

  function setViewedNote(conn: Connection, noteId: string | null) {
    const previous = conn.viewedNoteId;
    if (previous === noteId) return;
    if (previous !== null) {
      const m = presenceMap(conn.userId);
      const viewers = m.get(previous);
      if (viewers) {
        viewers.delete(conn.id);
        if (viewers.size === 0) m.delete(previous);
      }
      sendTo(conn.userId, {
        type: "presence:leave",
        noteId: previous,
        userId: conn.id,
      });
    }
    conn.viewedNoteId = noteId;
    if (noteId !== null) {
      const m = presenceMap(conn.userId);
      let viewers = m.get(noteId);
      if (!viewers) {
        viewers = new Set();
        m.set(noteId, viewers);
      }
      viewers.add(conn.id);
      sendTo(conn.userId, {
        type: "presence:join",
        noteId,
        userId: conn.id,
      });
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
          await sessionsRepo.touch(
            token,
            nowIso(),
            isoPlusDays(cfg.sessionTtlDays),
          );
          conn = {
            id: `c${++nextId}`,
            userId: session.user_id,
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
