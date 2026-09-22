import {
  APP_SOCKET_HEARTBEAT_MS,
  NoteColor,
  NoteFont,
  type PresenceUser,
  type ShareInvitation,
  type WebSocketClientEvent,
  type WebSocketEvent,
} from "@manifesto/shared";
import { effect, signal, untracked } from "@preact/signals";
import { loadNotes, notes, receiveNote } from "../state/actions.js";
import {
  authToken,
  clearAuthLocal,
  isServerMode,
  WS_ORIGIN,
} from "../state/auth.js";
import {
  clearPresence,
  recordPresenceJoin,
  recordPresenceLeave,
} from "../state/presence.js";
import {
  forgetInvitation,
  loadInvitations,
  receiveInvitation,
} from "../state/sharing.js";
import { editingNoteId } from "../state/ui.js";
import { trackConnection } from "./connectionOutage.js";

const SUBPROTOCOL = "manifesto-session";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

export const connectionStatus = signal<ConnectionStatus>("idle");

/** Every status write goes through here, so `connectionOutage` cannot drift
 * out of step with the socket it speaks for. */
function setStatus(next: ConnectionStatus) {
  connectionStatus.value = next;
  trackConnection(next);
}

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

/**
 * How long the socket may stay silent before we stop believing it. A socket
 * that dies without a close (a network change, a sleep, a NAT forgetting it)
 * stays `OPEN` here until TCP gives up, which can take many minutes, and all
 * that time the banner says connected while nothing arrives. The server sends
 * `heartbeat` on an interval, so two missed beats and some slack is enough to
 * call it.
 */
const SILENCE_LIMIT_MS = APP_SOCKET_HEARTBEAT_MS * 2.5;
let lastHeardAt = 0;
// Only a socket that has heard one heartbeat is held to the limit. A server
// from before heartbeats sends none, and a quiet board would otherwise be
// redialled every minute or so, forever.
let hearsHeartbeats = false;
let watchdog: ReturnType<typeof setInterval> | null = null;

function stopWatchdog() {
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
}

function hasGoneSilent(): boolean {
  return hearsHeartbeats && Date.now() - lastHeardAt > SILENCE_LIMIT_MS;
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function isPresenceUser(value: unknown): value is PresenceUser {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.displayName === "string" &&
    typeof v.avatarColor === "string"
  );
}

function isShareUser(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.username === "string" &&
    typeof v.displayName === "string" &&
    typeof v.avatarColor === "string"
  );
}

const noteColors = new Set<unknown>(Object.values(NoteColor));
const noteFonts = new Set<unknown>(Object.values(NoteFont));

/** Color and font are checked against the enums, not just typed as strings:
 * the invitation card indexes `noteColorMap` and `noteFontFamilies` with them,
 * and an unknown key throws while it renders. */
function isInvitation(value: unknown): value is ShareInvitation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.noteId === "string" &&
    (v.role === "edit" || v.role === "view") &&
    isShareUser(v.owner) &&
    typeof v.title === "string" &&
    typeof v.content === "string" &&
    noteColors.has(v.color) &&
    noteFonts.has(v.font) &&
    typeof v.invitedAt === "string"
  );
}

/**
 * Discriminates on the payload, not just on `type`, the mirror of the
 * server's `isClientEvent`. Accepting anything with a string `type` narrowed
 * to the union without checking the fields the branches then read, so a
 * malformed `note:created` put `undefined` into the notes list and a card
 * threw during render.
 */
export function isServerEvent(value: unknown): value is WebSocketEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case "note:created":
    case "note:updated":
      return (
        typeof v.note === "object" &&
        v.note !== null &&
        typeof (v.note as { id?: unknown }).id === "string"
      );
    case "note:deleted":
      return typeof v.id === "string";
    case "presence:join":
      return typeof v.noteId === "string" && isPresenceUser(v.user);
    case "presence:leave":
      return typeof v.noteId === "string" && typeof v.userId === "string";
    case "invitation:created":
      return isInvitation(v.invitation);
    case "invitation:removed":
      return typeof v.noteId === "string";
    case "heartbeat":
      return true;
    default:
      return false;
  }
}

function applyServerEvent(event: WebSocketEvent) {
  switch (event.type) {
    case "note:created":
    case "note:updated":
      receiveNote(event.note);
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
    case "invitation:created":
      receiveInvitation(event.invitation);
      break;
    case "invitation:removed":
      forgetInvitation(event.noteId);
      break;
    case "heartbeat":
      hearsHeartbeats = true;
      break;
  }
}

function send(event: WebSocketClientEvent) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

/** Let go of the current socket: stop hearing it, and close it if the browser
 * has not already. */
function dropSocket() {
  stopWatchdog();
  if (!socket) return;
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

function disconnect() {
  clearReconnect();
  dropSocket();
  // "idle", not "closed": this runs when the token changes, so we are not
  // failing to reach the server, we are not asking. A logout that reported an
  // outage would be reporting one that nobody is waiting to end.
  setStatus("idle");
  clearPresence();
  lastViewedNoteId = undefined;
  // Reset the "has opened once" flag: a token change (logout, re-login as a
  // different user) starts a fresh session that should NOT trigger the
  // reconnect-refetch on its first open.
  hasOpenedOnce = false;
}

function connect(token: string) {
  if (WS_ORIGIN === null) return;
  setStatus("connecting");
  // A new socket has not been heard from, and owes nothing to what the last
  // one heard.
  hearsHeartbeats = false;
  const ws = new WebSocket(`${WS_ORIGIN}/api/ws`, [SUBPROTOCOL, token]);
  socket = ws;

  ws.onopen = () => {
    setStatus("open");
    backoffMs = 1000;
    lastHeardAt = Date.now();
    stopWatchdog();
    watchdog = setInterval(() => {
      if (!hasGoneSilent()) return;
      // Closing it would wait on a closing handshake nobody will answer, so
      // let go of it and take the path a close would have taken.
      dropSocket();
      lost(1006);
    }, APP_SOCKET_HEARTBEAT_MS / 2);
    if (lastViewedNoteId !== undefined) {
      send({ type: "presence:update", noteId: lastViewedNoteId });
    }
    if (hasOpenedOnce) {
      // Reconnect path: only WS-bound state caught up via fan-out events. We
      // missed everything that happened while offline, so refetch the full
      // notes list. `foldIncomingList` keeps the notes that did not change,
      // and `receiveNote` handles any racing events that arrive between this
      // fire and the response.
      loadNotes().catch(() => {
        // Network blip during the catch-up fetch is fine; the next user
        // action or full reload will retry.
      });
      void loadInvitations();
    } else {
      hasOpenedOnce = true;
    }
  };

  ws.onmessage = (msg) => {
    lastHeardAt = Date.now();
    if (typeof msg.data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(msg.data);
    } catch {
      return;
    }
    if (isServerEvent(parsed)) applyServerEvent(parsed);
  };

  ws.onclose = (event) => lost(event.code);

  ws.onerror = () => {
    // onclose will follow with the reconnect logic
  };
}

/** The socket is gone, whether the browser said so or the silence did. */
function lost(code: number) {
  stopWatchdog();
  socket = null;
  setStatus("closed");
  if (code === 4401) {
    // server rejected our token, so drop local auth so the user re-logs in
    clearAuthLocal();
    return;
  }
  if (authToken.value) {
    backoffMs = Math.min(MAX_BACKOFF, backoffMs * 2);
    reconnectTimer = setTimeout(() => {
      // Re-read the token at fire time: the user could have logged out
      // (or had a token swap) between scheduling and this callback.
      const current = authToken.value;
      if (current) connect(current);
    }, backoffMs);
  }
}

/**
 * Dial now rather than waiting the backoff out, because something just told us
 * the network is worth another try: the app came back to the foreground, or
 * the browser went back online.
 *
 * An app resumed from the background comes back to a socket the browser closed
 * while the page was frozen, and to a backoff that the retries it did manage
 * in between may have grown to {@link MAX_BACKOFF}. Left alone, the notes list
 * would then stay stale, and the banner up, for half a minute after the app
 * was already on screen.
 */
function reconnectNow() {
  if (!isServerMode) return;
  const token = authToken.value;
  if (!token) return;
  // A socket that is open, or still dialling, is doing its job. One the browser
  // has closed under us is not, and its `onclose` may not have reached us yet:
  // a resume can deliver the visibility change first, and waiting for the close
  // would put us back on the very backoff we came here to skip. One that says
  // it is open but has not been heard from in too long is not either: a page
  // frozen for an hour had no timer running to notice.
  if (
    socket &&
    socket.readyState !== WebSocket.CLOSED &&
    socket.readyState !== WebSocket.CLOSING &&
    !hasGoneSilent()
  ) {
    return;
  }
  dropSocket();
  clearReconnect();
  backoffMs = 1000;
  connect(token);
}

let started = false;

/** Wire the WS client to auth + editor signals. Idempotent. */
export function startAppSocket(): void {
  if (started) return;
  started = true;

  // Only the token is this effect's business. Connecting writes status, and
  // anything that reads a signal on the way would otherwise become a reason to
  // tear the socket down and dial again.
  effect(() => {
    const token = authToken.value;
    untracked(() => {
      disconnect();
      if (token && isServerMode) connect(token);
    });
  });

  effect(() => {
    const id = editingNoteId.value ?? null;
    lastViewedNoteId = id;
    if (socket && socket.readyState === WebSocket.OPEN) {
      send({ type: "presence:update", noteId: id });
    }
  });

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reconnectNow();
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", reconnectNow);
  }
}
