import type {
  Note,
  WebSocketClientEvent,
  WebSocketEvent,
} from "@manifesto/shared";
import { effect, signal } from "@preact/signals";
import { loadNotes, notes } from "../state/actions.js";
import { authToken, clearAuthLocal, SERVER_URL } from "../state/auth.js";
import {
  clearPresence,
  recordPresenceJoin,
  recordPresenceLeave,
} from "../state/presence.js";
import { editingNoteId } from "../state/ui.js";

const SUBPROTOCOL = "manifesto-session";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

export const connectionStatus = signal<ConnectionStatus>("idle");

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 1000;
const MAX_BACKOFF = 30_000;
let lastViewedNoteId: string | null | undefined;
// True after the first successful connection for the current auth token. A
// fresh login starts at false; the first onopen flips it. Subsequent opens
// (after onclose triggers a reconnect) trigger a notes re-fetch so any writes
// that happened on another device while we were offline aren't missed.
let hasOpenedOnce = false;

function wsBaseUrl(): string | null {
  if (!SERVER_URL) return null;
  return SERVER_URL.replace(/^http/, "ws");
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function isServerEvent(value: unknown): value is WebSocketEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as { type?: unknown };
  return typeof v.type === "string";
}

function applyServerEvent(event: WebSocketEvent) {
  switch (event.type) {
    case "note:created":
      notes.value = upsertNote(notes.value, event.note);
      break;
    case "note:updated":
      notes.value = upsertNote(notes.value, event.note);
      break;
    case "note:deleted":
      notes.value = notes.value.filter((n) => n.id !== event.id);
      break;
    case "presence:join":
      recordPresenceJoin(event.noteId, event.user);
      break;
    case "presence:leave":
      recordPresenceLeave(event.noteId, event.userId);
      break;
  }
}

function upsertNote(list: Note[], note: Note): Note[] {
  const idx = list.findIndex((n) => n.id === note.id);
  if (idx === -1) return [...list, note];
  const next = list.slice();
  next[idx] = note;
  return next;
}

function send(event: WebSocketClientEvent) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function disconnect() {
  clearReconnect();
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
    socket = null;
  }
  connectionStatus.value = "closed";
  clearPresence();
  lastViewedNoteId = undefined;
  // Reset the "has opened once" flag — a token change (logout, re-login as a
  // different user) starts a fresh session that should NOT trigger the
  // reconnect-refetch on its first open.
  hasOpenedOnce = false;
}

function connect(token: string) {
  const base = wsBaseUrl();
  if (!base) return;
  connectionStatus.value = "connecting";
  const ws = new WebSocket(`${base}/api/ws`, [SUBPROTOCOL, token]);
  socket = ws;

  ws.onopen = () => {
    connectionStatus.value = "open";
    backoffMs = 1000;
    if (lastViewedNoteId !== undefined) {
      send({ type: "presence:update", noteId: lastViewedNoteId });
    }
    if (hasOpenedOnce) {
      // Reconnect path — only WS-bound state caught up via fan-out events. We
      // missed everything that happened while offline, so refetch the full
      // notes list. The signal-merge in upsertNote handles any racing events
      // that arrive between this fire and the response.
      loadNotes().catch(() => {
        // Network blip during the catch-up fetch is fine — the next user
        // action or full reload will retry.
      });
    } else {
      hasOpenedOnce = true;
    }
  };

  ws.onmessage = (msg) => {
    if (typeof msg.data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.data);
    } catch {
      return;
    }
    if (isServerEvent(parsed)) applyServerEvent(parsed);
  };

  ws.onclose = (event) => {
    socket = null;
    connectionStatus.value = "closed";
    if (event.code === 4401) {
      // server rejected our token — drop local auth so the user re-logs in
      clearAuthLocal();
      return;
    }
    if (authToken.value) {
      backoffMs = Math.min(MAX_BACKOFF, backoffMs * 2);
      reconnectTimer = setTimeout(() => {
        // Re-read the token at fire time — the user could have logged out
        // (or had a token swap) between scheduling and this callback.
        const current = authToken.value;
        if (current) connect(current);
      }, backoffMs);
    }
  };

  ws.onerror = () => {
    // onclose will follow with the reconnect logic
  };
}

let started = false;

/** Wire the WS client to auth + editor signals. Idempotent. */
export function startAppSocket(): void {
  if (started) return;
  started = true;

  effect(() => {
    const token = authToken.value;
    disconnect();
    if (token && SERVER_URL) connect(token);
  });

  effect(() => {
    const id = editingNoteId.value ?? null;
    lastViewedNoteId = id;
    if (socket && socket.readyState === WebSocket.OPEN) {
      send({ type: "presence:update", noteId: id });
    }
  });
}
