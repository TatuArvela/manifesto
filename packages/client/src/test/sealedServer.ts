import {
  isCiphertext,
  type SealedNote,
  type SealedNoteCreate,
  type SealedNoteImport,
  type SealedNoteUpdate,
  type SealedNoteVersion,
  type SealedNoteVersionCreateRequest,
} from "@manifesto/shared";
import type { StorageKeys } from "../storage/sealing.js";
import { derivable } from "../utils/seal.js";

/**
 * A server as the client meets it in connected mode, kept in memory: it
 * stores what it is sent and refuses anything readable where a ciphertext
 * belongs, as the real one does, and holds no key. A test reads `notes` to
 * see what a server would hold.
 */

/** An unlocked account's key, as the device holds it. */
export async function testKeys(userId = "u1"): Promise<StorageKeys> {
  return {
    userId,
    version: 1,
    accountKey: await derivable(crypto.getRandomValues(new Uint8Array(32))),
  };
}

const SEALED = [
  "title",
  "content",
  "excerpt",
  "font",
  "images",
  "linkPreviews",
] as const;
const PERSONAL = ["color", "tags"] as const;

function shapeProblem(body: Record<string, unknown>): string | null {
  for (const field of SEALED) {
    if (field in body && !isCiphertext(body[field], 1_000_000)) return field;
  }
  for (const field of PERSONAL) {
    if (field in body && body[field] !== "") {
      if (!isCiphertext(body[field], 1_000_000)) return field;
    }
  }
  if ("key" in body && !isCiphertext(body.key, 1024)) return "key";
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class SealedServer {
  readonly notes = new Map<string, SealedNote>();
  readonly versions = new Map<string, SealedNoteVersion[]>();
  /** Ids that belong to someone else's note, which an import is refused. */
  readonly taken = new Set<string>();
  /**
   * What the reader is sent of a note in place of the owner's own: a
   * recipient's copy of its key, or none and the key they are offered.
   */
  readonly views = new Map<string, Pick<SealedNote, "key" | "offered">>();
  /** Every request made, as `METHOD path`. */
  readonly requests: string[] = [];
  /** Sealed images, each with whose it is: `me` is the account under test. */
  readonly attachments = new Map<
    string,
    { owner: string; bytes: Uint8Array<ArrayBuffer> }
  >();
  /** The references each note was last sent beside its sealed lists. */
  readonly refs = new Map<
    string,
    { imageRefs?: string[]; previewRefs?: string[] }
  >();
  private nextAttachment = 0;

  /** Stores sealed bytes as an upload would, and answers their reference. */
  putAttachment(bytes: Uint8Array<ArrayBuffer>, owner = "me"): string {
    const id = `01J8Z3Q4R5S6T7V8W9X0Y1${String(this.nextAttachment++).padStart(4, "0")}`;
    this.attachments.set(id, { owner, bytes });
    return `attachment:${id}`;
  }

  private remember(id: string, body: Record<string, unknown>): void {
    const held = this.refs.get(id) ?? {};
    if (Array.isArray(body.imageRefs)) held.imageRefs = body.imageRefs;
    if (Array.isArray(body.previewRefs)) held.previewRefs = body.previewRefs;
    this.refs.set(id, held);
  }
  private clock = Date.parse("2026-04-01T00:00:00.000Z");

  private now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private stored(
    { imageRefs: _i, previewRefs: _p, ...fields }: SealedNoteCreate,
    createdAt?: string,
  ): SealedNote {
    const now = this.now();
    const note: SealedNote = {
      ...fields,
      trashedAt: null,
      createdAt: createdAt ?? now,
      updatedAt: now,
    };
    this.notes.set(note.id, note);
    return note;
  }

  /** A note as the reader is sent it. */
  private seen(note: SealedNote): SealedNote {
    return { ...note, ...this.views.get(note.id) };
  }

  /** Stands in for `fetch`. */
  readonly fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = new URL(String(input), "http://server.test");
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.pathname;
    this.requests.push(`${method} ${path}`);
    const body =
      typeof init.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};

    if (path === "/api/attachments/claim" && method === "POST") {
      // Every note here is the account's own, so anything held by someone
      // else is stored again for it.
      const refs = (body.refs as string[]).map((ref) => {
        const held = this.attachments.get(ref.slice("attachment:".length));
        if (!held || held.owner === "me") return ref;
        return this.putAttachment(held.bytes);
      });
      return json({ refs });
    }
    const attachment = /^\/api\/attachments\/([^/]+)$/.exec(path);
    if (attachment && method === "GET") {
      const held = this.attachments.get(attachment[1] ?? "");
      if (!held) return json({ error: "Attachment not found" }, 404);
      return new Response(held.bytes, {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
    if (path === "/api/notes" && method === "GET") {
      return json({ notes: [...this.notes.values()], nextCursor: null });
    }
    if (path === "/api/sync" && method === "GET") {
      return json({
        notes: [...this.notes.values()],
        nextCursor: null,
        ids: [...this.notes.keys()],
        checkpoint: "c1",
      });
    }
    if (path === "/api/notes" && method === "POST") {
      const problem = shapeProblem(body);
      if (problem) return json({ error: `${problem}: not sealed` }, 422);
      const create = body as unknown as SealedNoteCreate;
      if (this.notes.has(create.id)) return json({ error: "taken" }, 409);
      this.remember(create.id, body);
      return json({ note: this.stored(create) }, 201);
    }
    if (path === "/api/notes/import" && method === "POST") {
      const taken: string[] = [];
      let created = 0;
      let updated = 0;
      for (const item of body.notes as SealedNoteImport[]) {
        const problem = shapeProblem(
          item as unknown as Record<string, unknown>,
        );
        if (problem) return json({ error: `${problem}: not sealed` }, 422);
        if (this.taken.has(item.id)) {
          taken.push(item.id);
          continue;
        }
        if (this.notes.has(item.id)) updated++;
        else created++;
        const { createdAt, ...fields } = item;
        this.stored(fields, this.notes.get(item.id)?.createdAt ?? createdAt);
      }
      return json({
        created,
        updated,
        skipped: 0,
        ...(taken.length > 0 && { taken }),
      });
    }
    const versions = /^\/api\/notes\/([^/]+)\/versions$/.exec(path);
    if (versions) {
      const noteId = versions[1] ?? "";
      const list = this.versions.get(noteId) ?? [];
      if (method === "GET") return json({ versions: [...list].reverse() });
      const sent = body as unknown as SealedNoteVersionCreateRequest;
      if (!isCiphertext(sent.title, 1e6) || !isCiphertext(sent.content, 1e6)) {
        return json({ error: "not sealed" }, 422);
      }
      list.push({
        id: sent.id,
        noteId,
        keyVersion: sent.keyVersion,
        title: sent.title,
        content: sent.content,
        timestamp: sent.timestamp ?? this.now(),
      });
      this.versions.set(noteId, list);
      return new Response(null, { status: 201 });
    }
    const one = /^\/api\/notes\/([^/]+)$/.exec(path);
    if (one) {
      const id = one[1] ?? "";
      const note = this.notes.get(id);
      if (!note) return json({ error: "Note not found" }, 404);
      if (method === "GET") return json({ note: this.seen(note) });
      if (method === "DELETE") {
        this.notes.delete(id);
        return new Response(null, { status: 204 });
      }
      if (method === "PUT") {
        const problem = shapeProblem(body);
        if (problem) return json({ error: `${problem}: not sealed` }, 422);
        const ifMatch = new Headers(init.headers).get("If-Match");
        if (ifMatch !== null && ifMatch !== note.updatedAt) {
          return json({ error: "Note has changed", note }, 412);
        }
        const {
          imageRefs: _i,
          previewRefs: _p,
          ...changes
        } = body as SealedNoteUpdate;
        const next = { ...note, ...changes, updatedAt: this.now() };
        this.notes.set(id, next);
        this.remember(id, body);
        return json({ note: this.seen(next) });
      }
    }
    return json({ error: "Not found" }, 404);
  };

  /** Everything the server holds, as the text a copy of its database would
   * be. */
          keyVersion,
  dump(): string {
    return JSON.stringify([
        // Sealed under a key the note has since left.
        if (keyVersion !== undefined && keyVersion !== note.keyVersion) {
          return json({ error: "The note is under another key now" }, 409);
        }
      [...this.notes.values()],
      [...this.versions.values()],
    ]);
  }
}
