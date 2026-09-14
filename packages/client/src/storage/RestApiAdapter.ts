import type {
  ErrorResponse,
  LinkPreview,
  LinkPreviewResponse,
  Note,
  NoteCreate,
  NoteResponse,
  NotesResponse,
  NoteUpdate,
} from "@manifesto/shared";
import { roleOf } from "@manifesto/shared";
import type { StorageAdapter } from "./StorageAdapter.js";

export interface RestApiAdapterOptions {
  /** Invoked when the server returns 401, before the error is thrown. */
  onUnauthorized?: () => void;
}

/**
 * Thrown when an update collides with a newer server-side version. The
 * caller can use `currentNote` to run a 3-way merge and retry with a
 * fresh `If-Match`.
 */
export class NoteConflictError extends Error {
  constructor(public currentNote: Note) {
    super("Note has changed");
    this.name = "NoteConflictError";
  }
}

export class RestApiAdapter implements StorageAdapter {
  private baseUrl: string;
  private token: string;
  private onUnauthorized: (() => void) | undefined;

  constructor(
    baseUrl: string,
    token: string,
    options: RestApiAdapterOptions = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.onUnauthorized = options.onUnauthorized;
  }

  private headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  private async fail(res: Response, fallback: string): Promise<never> {
    if (res.status === 401) this.onUnauthorized?.();
    let message = fallback;
    try {
      const data = (await res.json()) as Partial<ErrorResponse>;
      if (typeof data.error === "string" && data.error.length > 0) {
        message = data.error;
      }
    } catch {
      // body was not JSON; keep the fallback message
    }
    throw new Error(message);
  }

  /**
   * Every page of a listing, concatenated.
   *
   * The app keeps all of a user's notes in one signal (`filteredNotes`,
   * `allTags` and the tag counts are computed over the whole list), so pages
   * are a property of the wire, not of the model: they bound any single
   * response without changing what the client holds. The notes come back
   * without their attachments; `loadImages` fetches those for the one note
   * that needs them.
   */
  private async drainPages(path: string, failure: string): Promise<Note[]> {
    const notes: Note[] = [];
    let cursor: string | null = null;
    do {
      const separator = path.includes("?") ? "&" : "?";
      const url = cursor
        ? `${this.baseUrl}${path}${separator}cursor=${encodeURIComponent(cursor)}`
        : `${this.baseUrl}${path}`;
      const res: Response = await fetch(url, { headers: this.headers() });
      if (!res.ok) await this.fail(res, failure);
      const data = (await res.json()) as NotesResponse;
      notes.push(...data.notes);
      cursor = data.nextCursor ?? null;
      // A page that came back empty cannot be followed by a useful one, and a
      // server that kept handing back the same cursor would spin here.
      if (data.notes.length === 0) break;
    } while (cursor !== null);
    return notes;
  }

  async getAll(): Promise<Note[]> {
    return await this.drainPages("/api/notes", "Failed to fetch notes");
  }

  /**
   * The attachments of one note, which a listing leaves behind. In open mode
   * they were never separated from the note, so `LocalStorageAdapter` answers
   * this from what it already has.
   */
  async loadImages(id: string): Promise<string[]> {
    const note = await this.get(id);
    return note?.images ?? [];
  }

  async get(id: string): Promise<Note | null> {
    const res = await fetch(`${this.baseUrl}/api/notes/${id}`, {
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, "Failed to fetch note");
    const data = (await res.json()) as NoteResponse;
    return data.note;
  }

  async create(note: NoteCreate): Promise<Note> {
    const res = await fetch(`${this.baseUrl}/api/notes`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(note),
    });
    if (!res.ok) await this.fail(res, "Failed to create note");
    const data = (await res.json()) as NoteResponse;
    return data.note;
  }

  async update(
    id: string,
    changes: NoteUpdate,
    options: { ifMatch?: string } = {},
  ): Promise<Note> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
    if (options.ifMatch !== undefined) headers["If-Match"] = options.ifMatch;
    const res = await fetch(`${this.baseUrl}/api/notes/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(changes),
    });
    if (res.status === 412) {
      const data = (await res.json()) as Partial<NoteResponse>;
      if (data?.note) throw new NoteConflictError(data.note);
    }
    if (!res.ok) await this.fail(res, "Failed to update note");
    const data = (await res.json()) as NoteResponse;
    return data.note;
  }

  async delete(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/notes/${id}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) await this.fail(res, "Failed to delete note");
  }

  async deleteAll(): Promise<void> {
    // "All your notes": the ones shared with you are someone else's to delete.
    const notes = (await this.getAll()).filter(
      (note) => roleOf(note) === "owner",
    );
    // Use allSettled so a single failed DELETE (e.g. 404 because another tab
    // already removed it) doesn't leave the rest of the notes intact. The
    // caller in actions.ts re-reads from the server after this resolves so
    // the signal converges regardless of how the delete shook out.
    const results = await Promise.allSettled(
      notes.map((n) => this.delete(n.id)),
    );
    const failures = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "Failed to delete some notes");
    }
  }

  async importAll(imported: Note[]): Promise<void> {
    const existing = await this.getAll();
    const existingIds = new Set(existing.map((n) => n.id));
    // A note shared with this user is already here, and belongs to someone
    // else: importing a backup is not a way to overwrite it.
    const sharedIds = new Set(
      existing.filter((n) => roleOf(n) !== "owner").map((n) => n.id),
    );
    for (const note of imported) {
      if (sharedIds.has(note.id)) continue;
      // Strip server-assigned fields. The server's noteUpdateSchema strips
      // them anyway, but sending them is misleading and bloats the payload.
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        sharing: _sharing,
        ...payload
      } = note;
      if (existingIds.has(note.id)) {
        await this.update(note.id, payload);
      } else {
        await this.create(payload);
      }
    }
  }

  async fetchLinkPreview(url: string): Promise<LinkPreview | null> {
    const res = await fetch(
      `${this.baseUrl}/api/link-preview?url=${encodeURIComponent(url)}`,
      { headers: this.headers() },
    );
    // Previews turned off on this server: the plain card is the answer.
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, "Failed to fetch link preview");
    const data = (await res.json()) as LinkPreviewResponse;
    return data.preview;
  }

  async search(query: string): Promise<Note[]> {
    return await this.drainPages(
      `/api/search?q=${encodeURIComponent(query)}`,
      "Failed to search notes",
    );
  }
}
