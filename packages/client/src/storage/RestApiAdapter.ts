import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";
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
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === "string" && data.error.length > 0) {
        message = data.error;
      }
    } catch {
      // body was not JSON; keep the fallback message
    }
    throw new Error(message);
  }

  async getAll(): Promise<Note[]> {
    const res = await fetch(`${this.baseUrl}/api/notes`, {
      headers: this.headers(),
    });
    if (!res.ok) await this.fail(res, "Failed to fetch notes");
    const data = await res.json();
    return data.notes;
  }

  async get(id: string): Promise<Note | null> {
    const res = await fetch(`${this.baseUrl}/api/notes/${id}`, {
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, "Failed to fetch note");
    const data = await res.json();
    return data.note;
  }

  async create(note: NoteCreate): Promise<Note> {
    const res = await fetch(`${this.baseUrl}/api/notes`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(note),
    });
    if (!res.ok) await this.fail(res, "Failed to create note");
    const data = await res.json();
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
      const data = (await res.json()) as { note?: Note };
      if (data?.note) throw new NoteConflictError(data.note);
    }
    if (!res.ok) await this.fail(res, "Failed to update note");
    const data = await res.json();
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
    const notes = await this.getAll();
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
    for (const note of imported) {
      // Strip server-assigned fields. The server's noteUpdateSchema strips
      // them anyway, but sending them is misleading and bloats the payload.
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...payload
      } = note;
      if (existingIds.has(note.id)) {
        await this.update(note.id, payload);
      } else {
        await this.create(payload);
      }
    }
  }

  async search(query: string): Promise<Note[]> {
    const res = await fetch(
      `${this.baseUrl}/api/search?q=${encodeURIComponent(query)}`,
      { headers: this.headers() },
    );
    if (!res.ok) await this.fail(res, "Failed to search notes");
    const data = await res.json();
    return data.notes;
  }
}
