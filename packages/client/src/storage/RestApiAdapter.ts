import type { Note, NoteCreate, NoteUpdate } from "@manifesto/shared";
import type { StorageAdapter } from "./StorageAdapter.js";

export class RestApiAdapter implements StorageAdapter {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  async getAll(): Promise<Note[]> {
    const res = await fetch(`${this.baseUrl}/api/notes`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error("Failed to fetch notes");
    const data = await res.json();
    return data.notes;
  }

  async get(id: string): Promise<Note | null> {
    const res = await fetch(`${this.baseUrl}/api/notes/${id}`, {
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Failed to fetch note");
    const data = await res.json();
    return data.note;
  }

  async create(note: NoteCreate): Promise<Note> {
    const res = await fetch(`${this.baseUrl}/api/notes`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(note),
    });
    if (!res.ok) throw new Error("Failed to create note");
    const data = await res.json();
    return data.note;
  }

  async update(id: string, changes: NoteUpdate): Promise<Note> {
    const res = await fetch(`${this.baseUrl}/api/notes/${id}`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(changes),
    });
    if (!res.ok) throw new Error("Failed to update note");
    const data = await res.json();
    return data.note;
  }

  async delete(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/notes/${id}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error("Failed to delete note");
  }

  async deleteAll(): Promise<void> {
    const notes = await this.getAll();
    await Promise.all(notes.map((n) => this.delete(n.id)));
  }

  async importAll(imported: Note[]): Promise<void> {
    const existing = await this.getAll();
    const existingIds = new Set(existing.map((n) => n.id));
    for (const note of imported) {
      if (existingIds.has(note.id)) {
        await this.update(note.id, note);
      } else {
        await this.create(note);
      }
    }
  }

  async search(query: string): Promise<Note[]> {
    const res = await fetch(
      `${this.baseUrl}/api/search?q=${encodeURIComponent(query)}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error("Failed to search notes");
    const data = await res.json();
    return data.notes;
  }
}
