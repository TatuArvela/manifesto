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

// --- WebSocket events (server → client) ---

export type WebSocketEvent =
  | { type: "note:updated"; note: Note }
  | { type: "note:created"; note: Note }
  | { type: "note:deleted"; id: string }
  | { type: "presence:join"; noteId: string; userId: string }
  | { type: "presence:leave"; noteId: string; userId: string };

// --- WebSocket events (client → server) ---

export type WebSocketClientEvent =
  | { type: "note:edit"; id: string; changes: Partial<Note> }
  | { type: "presence:update"; noteId: string };
