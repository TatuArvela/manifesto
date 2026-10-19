import type { NoteComment } from "./comments.ts";
import type { SealedAccountPrefs, SealedNote } from "./sealed.ts";
import type { ShareInvitation } from "./sharing.ts";

// --- WebSocket events (server → client) ---

/**
 * How frequently the server sends `heartbeat` on `/api/v1/ws`. A socket that
 * dies without a close stays open at both ends. Thus, when the silence is
 * longer than some of these, each side learns that nobody is there.
 */
export const APP_SOCKET_HEARTBEAT_MS = 30_000;

/**
 * The version of the document shape that the editor writes into the shared
 * Y.Doc of a note on `/api/v1/yjs`. Make it higher each time a node or mark is
 * added or removed, or changes its attributes. An editor that finds a node for
 * which it has no schema removes it, and `ySyncPlugin` then writes the loss
 * back to all persons.
 *
 * The client sends its version as the `editor` query parameter of the socket
 * URL. The server refuses a version that is lower than its own with
 * `EDITOR_OUTDATED_REASON`. A client that sends no version is version 1, the
 * shape from before the check.
 */
export const EDITOR_SCHEMA_VERSION = 1;

/**
 * The refusal reason of `/api/v1/yjs` for an editor older than that of the
 * server.
 */
export const EDITOR_OUTDATED_REASON = "editor-outdated";

export interface PresenceUser {
  id: string;
  displayName: string;
  avatarColor: string;
}

export type WebSocketEvent =
  | { type: "note:updated"; note: SealedNote }
  | { type: "note:created"; note: SealedNote }
  | { type: "note:deleted"; id: string }
  | { type: "presence:join"; noteId: string; user: PresenceUser }
  | { type: "presence:leave"; noteId: string; userId: string }
  | { type: "invitation:created"; invitation: ShareInvitation }
  | { type: "invitation:removed"; noteId: string }
  | { type: "comment:created"; comment: NoteComment }
  | { type: "comment:updated"; comment: NoteComment }
  | { type: "comment:deleted"; noteId: string; id: string }
  | { type: "prefs:updated"; prefs: SealedAccountPrefs }
  | { type: "heartbeat" };

// --- WebSocket events (client → server) ---

export type WebSocketClientEvent = {
  type: "presence:update";
  noteId: string | null;
};
