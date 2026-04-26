import type { Note } from "./note.js";

// --- REST responses ---

export interface NotesResponse {
  notes: Note[];
}

export interface NoteResponse {
  note: Note;
}

export interface ErrorResponse {
  error: string;
}

// --- Search ---

export interface SearchParams {
  q: string;
}

// --- Auth ---

export interface AuthCredentials {
  username: string;
  password: string;
}

export type AuthProviderName = "local" | "oidc";

export interface AuthMethodsResponse {
  provider: AuthProviderName;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
}

export interface AuthMeResponse {
  user: AuthUser;
}

export interface AuthSuccessResponse {
  token: string;
  user: AuthUser;
}

// --- WebSocket events (server → client) ---

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
  | { type: "presence:leave"; noteId: string; userId: string };

// --- WebSocket events (client → server) ---

export type WebSocketClientEvent =
  | { type: "note:edit"; id: string; changes: Partial<Note> }
  | { type: "presence:update"; noteId: string | null };
