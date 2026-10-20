import {
  APP_SOCKET_HEARTBEAT_MS,
  type PresenceUser,
  type ShareInvitation,
  type WebSocketClientEvent,
  type WebSocketEvent,
} from "@manifesto/shared";
import { effect, signal, untracked } from "@preact/signals";
import {
  authToken,
  clearAuthLocal,
  isServerMode,
  WS_ORIGIN,
} from "#/state/account/auth.ts";
import {
  forgetComment,
  receiveComment,
  reloadComments,
} from "#/state/comments.ts";
import {
  forgetNote,
  notes,
  receiveNote,
  syncNotes,
} from "#/state/notesStore.ts";
import { receiveAccountPrefs, refreshAccountPrefs } from "#/state/prefsSync.ts";
import {
  clearPresence,
  recordPresenceJoin,
  recordPresenceLeave,
} from "#/state/presence.ts";
import {
  forgetInvitation,
  loadInvitations,
  receiveInvitation,
} from "#/state/sharing.ts";
import { editingNoteId } from "#/state/ui.ts";
import { sendUnsent } from "#/state/unsentNotes.ts";
import { sealer } from "#/storage/sealing.ts";
import { trackConnection } from "./connectionOutage.ts";

const SUBPROTOCOL = "manifesto-session";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

export const connectionStatus = signal<ConnectionStatus>("idle");

/**
 * Each status write goes through here. Thus, `connectionOutage` always agrees
 * with its socket.
 */
function setStatus(next: ConnectionStatus) {
  connectionStatus.value = next;
  trackConnection(next);
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 1000;
const MAX_BACKOFF = 30_000;
let lastViewedNoteId: string | null | undefined;
// True after the first successful connection for the current auth token. A new
// login starts at false. The first onopen changes it. Later opens (after
// onclose causes a reconnect) get the notes again. Thus, the client does not
// miss writes that occurred on a different device while it was offline.
let hasOpenedOnce = false;

/**
 * How long the socket can stay silent before we stop to believe it. A socket
 * that dies without a close (a network change, a sleep, a NAT that forgets it)
 * stays `OPEN` here until TCP stops, which can take many minutes. During all
 * that time, the banner says connected while nothing arrives. The server sends
 * `heartbeat` at an interval. Thus, two missed beats and some spare time are
 * sufficient to decide.
 */
const SILENCE_LIMIT_MS = APP_SOCKET_HEARTBEAT_MS * 2.5;
let lastHeardAt = 0;
// The limit applies only to a socket that heard one heartbeat. A server from
// before heartbeats sends none. If not, the client would connect again to a
// quiet board approximately each minute, forever.
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

/**
 * Only the shape. What an invitation shows is sealed, and is checked when it is
 * opened (`state/sharing.ts`).
 */
function isInvitation(value: unknown): value is ShareInvitation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.noteId === "string" &&
    (v.role === "edit" || v.role === "view") &&
    isShareUser(v.owner) &&
    typeof v.title === "string" &&
    typeof v.content === "string" &&
    typeof v.font === "string" &&
    typeof v.keyVersion === "number" &&
    (v.offered === null || typeof v.offered === "object") &&
    typeof v.invitedAt === "string"
  );
}

function isComment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.noteId === "string" &&
    typeof c.body === "string" &&
    typeof c.createdAt === "string" &&
    (c.editedAt === null || typeof c.editedAt === "string") &&
    (c.author === null || isShareUser(c.author))
  );
}

/**
 * Discriminates on the payload, not only on `type`, as the `isClientEvent` of
 * the server does. When it accepted each value with a string `type`, it
 * narrowed to the union without a check of the fields that the branches then
 * read. Thus, a malformed `note:created` put `undefined` into the notes list,
 * and a card threw during render.
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
    case "comment:created":
    case "comment:updated":
      return isComment(v.comment);
    case "comment:deleted":
      return typeof v.noteId === "string" && typeof v.id === "string";
    case "prefs:updated":
      return (
        typeof v.prefs === "object" &&
        v.prefs !== null &&
        !Array.isArray(v.prefs)
      );
    case "heartbeat":
      return true;
    default:
      return false;
  }
}

/**
 * The subject of an event. Events about one note wait for each other, and for
 * nothing else.
 */
function subjectOf(event: Exclude<WebSocketEvent, { type: "heartbeat" }>) {
  switch (event.type) {
    case "note:created":
    case "note:updated":
      return event.note.id;
    case "note:deleted":
      return event.id;
    case "invitation:created":
      return event.invitation.noteId;
    case "comment:created":
    case "comment:updated":
      return event.comment.noteId;
    case "prefs:updated":
      return "prefs";
    default:
      return event.noteId;
  }
}

/**
 * The last event that applies for each subject. A note arrives sealed, and its
 * open takes a short time (a request, when its key is offered). Thus, events
 * about the same note wait for each other: a deletion must not come before the
 * update before it. The events of a different note do not wait behind a slow
 * one.
 */
const applying = new Map<string, Promise<void>>();

/**
 * Increased each time a reconnect starts a catch-up through `syncNotes`. An
 * event that the previous socket delivered can still be in its open when the
 * sync already dropped its note. That event is older than the sync. Thus, it
 * can refresh a note that is still held, but never bring one back.
 */
let catchUps = 0;

function queueServerEvent(event: WebSocketEvent) {
  // A heartbeat is about the socket, not the notes. It waits for nothing. If
  // not, a slow note would make a live socket look silent.
  if (event.type === "heartbeat") {
    hearsHeartbeats = true;
    return;
  }
  const subject = subjectOf(event);
  // Sent to the session that was unlocked when it arrived. A session that was
  // locked or signed out after that does not apply it for the next user.
  const session = sealer.peek();
  const heardAt = catchUps;
  const next = (applying.get(subject) ?? Promise.resolve())
    .then(() =>
      sealer.peek() === session ? applyServerEvent(event, heardAt) : undefined,
    )
    .catch((err) => console.warn("Failed to apply a server event:", err))
    .finally(() => {
      if (applying.get(subject) === next) applying.delete(subject);
    });
  applying.set(subject, next);
}

async function applyServerEvent(event: WebSocketEvent, heardAt: number) {
  switch (event.type) {
    case "note:created":
    case "note:updated": {
      // Null while locked, and for a note whose key did not open. In both
      // cases, there is nothing readable to show.
      const note = await sealer.peek()?.open(event.note);
      if (!note) break;
      // A catch-up came before it while it opened. A note that the sync dropped
      // stays dropped.
      const stale = heardAt !== catchUps;
      if (stale && !notes.peek().some((n) => n.id === note.id)) break;
      receiveNote(note);
      break;
    }
    case "note:deleted":
      sealer.peek()?.forget(event.id);
      forgetNote(event.id);
      break;
    case "presence:join":
      recordPresenceJoin(event.noteId, event.user);
      break;
    case "presence:leave":
      recordPresenceLeave(event.noteId, event.userId);
      break;
    case "invitation:created":
      await receiveInvitation(event.invitation);
      break;
    case "invitation:removed":
      forgetInvitation(event.noteId);
      break;
    case "comment:created":
    case "comment:updated":
      await receiveComment(event.comment);
      break;
    case "comment:deleted":
      forgetComment(event.noteId, event.id);
      break;
    case "prefs:updated":
      await receiveAccountPrefs(event.prefs);
      break;
  }
}

function send(event: WebSocketClientEvent) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

/**
 * Release the current socket: stop to listen to it, and close it if the browser
 * did not already.
 */
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
  // "idle", not "closed". This runs when the token changes. Thus, we do not
  // fail to reach the server. We do not ask. A logout that reported an outage
  // would report an outage for whose end nobody waits.
  setStatus("idle");
  clearPresence();
  lastViewedNoteId = undefined;
  // Reset the "has opened once" flag. A token change (logout, a new login as a
  // different user) starts a new session, which must NOT cause the reconnect
  // fetch on its first open.
  hasOpenedOnce = false;
}

function connect(token: string) {
  if (WS_ORIGIN === null) return;
  setStatus("connecting");
  // A new socket did not send anything yet, and owes nothing to what the last
  // socket heard.
  hearsHeartbeats = false;
  const ws = new WebSocket(`${WS_ORIGIN}/api/v1/ws`, [SUBPROTOCOL, token]);
  socket = ws;

  ws.onopen = () => {
    setStatus("open");
    backoffMs = 1000;
    lastHeardAt = Date.now();
    stopWatchdog();
    watchdog = setInterval(() => {
      if (!hasGoneSilent()) return;
      // A close would wait for a closing handshake that nobody will answer.
      // Thus, release it, and take the path that a close would have taken.
      dropSocket();
      lost(1006);
    }, APP_SOCKET_HEARTBEAT_MS / 2);
    if (lastViewedNoteId !== undefined) {
      send({ type: "presence:update", noteId: lastViewedNoteId });
    }
    if (hasOpenedOnce) {
      // The reconnect path. Only the WS state got updates through fan-out
      // events. We missed all that occurred while offline. Thus, ask for what
      // changed since the last read (`syncNotes`, which lists all notes when it
      // cannot). `receiveNote` keeps the notes that did not change, and handles
      // events that race and arrive between this fire and the response.
      catchUps++;
      syncNotes().catch(() => {
        // A network problem during the catch-up fetch is acceptable. The next
        // user action or full reload tries again.
      });
      void loadInvitations();
      void refreshAccountPrefs();
      reloadComments();
      void sendUnsent();
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
    if (isServerEvent(parsed)) queueServerEvent(parsed);
  };

  ws.onclose = (event) => lost(event.code);

  ws.onerror = () => {
    // onclose follows, with the reconnect logic.
  };
}

/** The socket is gone, whether the browser said so or the silence did. */
function lost(code: number) {
  stopWatchdog();
  socket = null;
  setStatus("closed");
  if (code === 4401) {
    // The server refused our token. Thus, drop the local auth, so that the user
    // logs in again.
    clearAuthLocal();
    return;
  }
  if (authToken.value) {
    backoffMs = Math.min(MAX_BACKOFF, backoffMs * 2);
    reconnectTimer = setTimeout(() => {
      // Read the token again at fire time. The user could have logged out (or
      // had a token change) between the schedule and this callback.
      const current = authToken.value;
      if (current) connect(current);
    }, backoffMs);
  }
}

/**
 * Connect now, and do not wait for the end of the backoff, because something
 * just said that the network is worth another try: the app came back to the
 * foreground, or the browser went back online.
 *
 * An app that resumes from the background comes back to a socket that the
 * browser closed while the page was frozen. It also comes back to a backoff
 * that its retries in the meantime possibly made as long as {@link
 * MAX_BACKOFF}. Without this, the notes list would stay stale, and the banner
 * open, for half a minute after the app was already on the screen.
 */
function reconnectNow() {
  if (!isServerMode) return;
  const token = authToken.value;
  if (!token) return;
  // A socket that is open, or still connects, does its job. A socket that the
  // browser closed does not, and its `onclose` possibly did not reach us yet. A
  // resume can deliver the visibility change first, and a wait for the close
  // would put us back on the same backoff that we came here to skip. A socket
  // that says that it is open, but that sent nothing for too long, also does
  // not do its job. A page that was frozen for one hour had no timer that could
  // see it.
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

/** Connect the WS client to the auth and editor signals. Idempotent. */
export function startAppSocket(): void {
  if (started) return;
  started = true;

  // Only the token concerns this effect. A connection writes status. If code
  // read a signal on the way, that would otherwise become a reason to close the
  // socket and connect again.
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
