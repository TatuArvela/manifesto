import type { Note } from "../note.js";
import type { NoteComment } from "./comments.js";
import type { AccountPrefs } from "./prefs.js";
import type { ShareInvitation } from "./sharing.js";

// --- WebSocket events (server → client) ---

/**
 * How often the server sends `heartbeat` on `/api/ws`. A socket that dies
 * without a close stays open to both ends, so silence longer than a couple of
 * these is how each side learns it is talking to nobody.
 */
export const APP_SOCKET_HEARTBEAT_MS = 30_000;

/**
 * The version of the document shape the editor writes into a note's shared
 * Y.Doc on `/api/yjs`. Raise it whenever a node or mark is added, removed or
 * changes its attributes: an editor that meets a node it has no schema for
 * drops it, and `ySyncPlugin` then writes the loss back to everyone.
 *
 * The client sends its version as the `editor` query parameter of the socket
 * URL, and the server refuses a lower one than its own with
 * `EDITOR_OUTDATED_REASON`. A client that sends none is version 1, the shape
 * from before the check existed.
 */
export const EDITOR_SCHEMA_VERSION = 1;

/** The refusal reason `/api/yjs` gives an editor older than the server's. */
export const EDITOR_OUTDATED_REASON = "editor-outdated";

export interface PresenceUser {
  id: string;
  displayName: string;
  avatarColor: string;
}

export type WebSocketEvent =
  | { type: "note:updated"; note: Note }
  | { type: "note:created"; note: Note }
  | { type: "note:deleted"; id: string }
  | { type: "presence:join"; noteId: string; user: PresenceUser }
  | { type: "presence:leave"; noteId: string; userId: string }
  | { type: "invitation:created"; invitation: ShareInvitation }
  | { type: "invitation:removed"; noteId: string }
  | { type: "comment:created"; comment: NoteComment }
  | { type: "comment:updated"; comment: NoteComment }
  | { type: "comment:deleted"; noteId: string; id: string }
  | { type: "prefs:updated"; prefs: AccountPrefs }
  | { type: "heartbeat" };

// --- WebSocket events (client → server) ---

export type WebSocketClientEvent =
  | { type: "note:edit"; id: string; changes: Partial<Note> }
  | { type: "presence:update"; noteId: string | null };
