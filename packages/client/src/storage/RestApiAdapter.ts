import type {
  AttachmentUploadResponse,
  ErrorResponse,
  LinkPreview,
  LinkPreviewResponse,
  Note,
  NoteCreate,
  NoteResponse,
  NotesImportResponse,
  NotesResponse,
  NoteUpdate,
  NoteVersion,
  SealedNote,
  SealedNoteImport,
  SealedNoteVersion,
  SyncResponse,
} from "@manifesto/shared";
import {
  attachmentIdOf,
  MAX_NOTES_PER_IMPORT,
  mapPreviewImages,
} from "@manifesto/shared";
import { ulid } from "ulid";
import { dataUrlToBlob } from "../utils/dataUrl.js";
import type { NoteChanges, StorageAdapter } from "./StorageAdapter.js";
import { LockedError, type NoteSealing } from "./sealing.js";

/** Under the server's 1 MiB body limit, with room for the request's own
 * wrapping. */
const IMPORT_REQUEST_BYTES = 900 * 1024;

const textEncoder = new TextEncoder();

export interface RestApiAdapterOptions {
  /** Invoked when the server returns 401, before the error is thrown. */
  onUnauthorized?: (() => void) | undefined;
  /**
   * Seals what is sent and opens what arrives. Null while the account is
   * locked, and then nothing that holds a note's words can be read or
   * written.
   */
  sealer?: NoteSealing | null | undefined;
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

/** An image upload the server refused (`status`), or that never arrived (0). */
export class ImageUploadError extends Error {
  constructor(readonly status: number) {
    super(`Image upload failed (${status})`);
    this.name = "ImageUploadError";
  }
}

export class RestApiAdapter implements StorageAdapter {
  private baseUrl: string;
  private token: string;
  private onUnauthorized: (() => void) | undefined;
  private sealer: NoteSealing | null;

  constructor(
    baseUrl: string,
    token: string,
    options: RestApiAdapterOptions = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.onUnauthorized = options.onUnauthorized;
    this.sealer = options.sealer ?? null;
  }

  /** The account's sealing, or a refusal while it is locked. */
  private sealing(): NoteSealing {
    if (!this.sealer) throw new LockedError();
    return this.sealer;
  }

  /** A note as the server holds it, for a key this device has not opened. */
  private readonly sealedNote = (id: string) => async () => {
    const res = await fetch(`${this.baseUrl}/api/notes/${id}`, {
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, "Failed to fetch note");
    return ((await res.json()) as NoteResponse<SealedNote>).note;
  };

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
    const sealing = this.sealing();
    const notes: Note[] = [];
    let cursor: string | null = null;
    do {
      const url = cursor
        ? `${this.baseUrl}${path}?cursor=${encodeURIComponent(cursor)}`
        : `${this.baseUrl}${path}`;
      const res: Response = await fetch(url, { headers: this.headers() });
      if (!res.ok) await this.fail(res, failure);
      const data = (await res.json()) as NotesResponse<SealedNote>;
      notes.push(...(await sealing.openAll(data.notes)));
      cursor = data.nextCursor ?? null;
      // A page that came back empty cannot be followed by a useful one, and a
      // server that kept handing back the same cursor would spin here.
      if (data.notes.length === 0) break;
    } while (cursor !== null);
    return notes;
  }

  async getAll(): Promise<Note[]> {
    const notes = await this.drainPages("/api/notes", "Failed to fetch notes");
    this.sealer?.markComplete();
    return notes;
  }

  /**
   * Every page of one sync. The checkpoint and the ids come on the last page,
   * and the checkpoint is fixed by the server when the first was asked for.
   *
   * A server from before `/api/sync` answers 404, which is read as keeping no
   * record of change: the caller lists everything, as it did then.
   */
  async changesSince(since: string | null): Promise<NoteChanges | null> {
    const sealing = this.sealing();
    const notes: Note[] = [];
    let cursor: string | null = null;
    for (;;) {
      const query = new URLSearchParams();
      if (since !== null) query.set("since", since);
      if (cursor !== null) query.set("cursor", cursor);
      const search = query.size > 0 ? `?${query}` : "";
      const res: Response = await fetch(`${this.baseUrl}/api/sync${search}`, {
        headers: this.headers(),
      });
      if (res.status === 404 && cursor === null) return null;
      if (!res.ok) await this.fail(res, "Failed to sync notes");
      const data = (await res.json()) as SyncResponse<SealedNote>;
      notes.push(...(await sealing.openAll(data.notes)));
      if (data.nextCursor === null) {
        if (data.ids === null || data.checkpoint === null) {
          throw new Error("Sync ended without a checkpoint");
        }
        if (since === null) sealing.markComplete();
        return { notes, ids: data.ids, checkpoint: data.checkpoint };
      }
      // A cursor handed back unchanged would spin here, as in `drainPages`.
      if (data.nextCursor === cursor) throw new Error("Sync did not advance");
      cursor = data.nextCursor;
    }
  }

  /**
   * The images of one note. A listing carries them now, so this is a read of
   * the note for whoever still asks.
   */
  async loadImages(id: string): Promise<string[]> {
    const note = await this.get(id);
    return note?.images ?? [];
  }

  async listVersions(noteId: string): Promise<NoteVersion[]> {
    const res = await fetch(`${this.baseUrl}/api/notes/${noteId}/versions`, {
      headers: this.headers(),
    });
    if (!res.ok) await this.fail(res, "Failed to fetch versions");
    const { versions } = (await res.json()) as {
      versions: SealedNoteVersion[];
    };
    return await this.sealing().openVersions(
      noteId,
      versions,
      this.sealedNote(noteId),
    );
  }

  async saveVersion(
    noteId: string,
    version: { title: string; content: string; timestamp?: string },
  ): Promise<void> {
    const sealed = await this.sealing().sealVersion(
      noteId,
      version,
      this.sealedNote(noteId),
    );
    const res = await fetch(`${this.baseUrl}/api/notes/${noteId}/versions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(sealed),
    });
    if (!res.ok) await this.fail(res, "Failed to save version");
  }

  async loadImage(ref: string): Promise<Blob> {
    const res = await fetch(
      `${this.baseUrl}/api/attachments/${attachmentIdOf(ref)}`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    if (!res.ok) await this.fail(res, "Failed to fetch attachment");
    return await res.blob();
  }

  async get(id: string): Promise<Note | null> {
    const sealing = this.sealing();
    const sealed = await this.sealedNote(id)();
    return sealed ? await sealing.open(sealed) : null;
  }

  /** The note in an answer, opened; a note that will not open is a failed
   * request, since the caller asked for it by writing it. */
  private async opened(res: Response, failure: string): Promise<Note> {
    const data = (await res.json()) as NoteResponse<SealedNote>;
    const note = await this.sealing().open(data.note);
    if (!note) throw new Error(failure);
    return note;
  }

  /**
   * Uploads one image and resolves its `attachment:` reference. Through
   * `XMLHttpRequest` rather than `fetch`, since only it reports how much of
   * the body has gone.
   */
  putImage(
    image: Blob,
    options: {
      onProgress?: (fraction: number) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // An `abort` listener never hears a signal that has already fired.
      if (options.signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${this.baseUrl}/api/attachments`);
      xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
      xhr.setRequestHeader("Content-Type", image.type);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          options.onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) this.onUnauthorized?.();
        if (xhr.status !== 201) {
          reject(new ImageUploadError(xhr.status));
          return;
        }
        try {
          resolve(
            (JSON.parse(xhr.responseText) as AttachmentUploadResponse).ref,
          );
        } catch {
          reject(new ImageUploadError(xhr.status));
        }
      };
      xhr.onerror = () => reject(new ImageUploadError(0));
      xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
      options.signal?.addEventListener("abort", () => xhr.abort(), {
        once: true,
      });
      xhr.send(image);
    });
  }

  /**
   * Any image still inline, uploaded and replaced by its reference: a note
   * write carries references only. The editor uploads as images are attached;
   * this catches the rest (an import, something shared to the app).
   */
  private async uploadInline(images: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const image of images) {
      out.push(
        image.startsWith("data:")
          ? await this.putImage(dataUrlToBlob(image))
          : image,
      );
    }
    return out;
  }

  /**
   * The same for link preview images. One that will not upload is dropped
   * and the card kept, since the server refuses a preview image held inline.
   */
  private async uploadInlinePreviews(
    previews: LinkPreview[],
  ): Promise<LinkPreview[]> {
    return await mapPreviewImages(previews, async (image) => {
      if (!image.startsWith("data:")) return image;
      try {
        return await this.putImage(dataUrlToBlob(image));
      } catch {
        return undefined;
      }
    });
  }

  /** A note write with everything inline uploaded first. */
  private async withUploads<T extends NoteUpdate>(changes: T): Promise<T> {
    return {
      ...changes,
      ...(changes.images && {
        images: await this.uploadInline(changes.images),
      }),
      ...(changes.linkPreviews && {
        linkPreviews: await this.uploadInlinePreviews(changes.linkPreviews),
      }),
    };
  }

  async create(note: NoteCreate): Promise<Note> {
    const sealing = this.sealing();
    // The id is chosen here: everything sealed is bound to it.
    const sealed = await sealing.sealNew(ulid(), await this.withUploads(note));
    const res = await fetch(`${this.baseUrl}/api/notes`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(sealed),
    });
    if (!res.ok) {
      sealing.forget(sealed.id);
      await this.fail(res, "Failed to create note");
    }
    return await this.opened(res, "Failed to create note");
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
    const sealing = this.sealing();
    const body = await sealing.sealUpdate(
      id,
      await this.withUploads(changes),
      this.sealedNote(id),
    );
    const res = await fetch(`${this.baseUrl}/api/notes/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 412) {
      const data = (await res.json()) as Partial<NoteResponse<SealedNote>>;
      const current = data?.note ? await sealing.open(data.note) : null;
      if (current) throw new NoteConflictError(current);
    }
    if (!res.ok) await this.fail(res, "Failed to update note");
    return await this.opened(res, "Failed to update note");
  }

  async delete(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/notes/${id}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) await this.fail(res, "Failed to delete note");
    this.sealer?.forget(id);
  }

  async deleteAll(): Promise<void> {
    // The server deletes the notes this user owns; the ones shared with them
    // are someone else's.
    const res = await fetch(`${this.baseUrl}/api/notes`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) await this.fail(res, "Failed to delete notes");
  }

  /**
   * Sends a backup in as few requests as the server's limits allow. Each note
   * keeps its id and creation time, so the server updates the notes it
   * already has and importing the same file twice changes nothing.
   */
  async importAll(imported: Note[]): Promise<void> {
    const sealing = this.sealing();
    // A note this account already holds is written over under the key it
    // has, so every key has to be at hand before the first is sealed.
    if (!sealing.complete) await this.getAll();
    type Plain = Omit<Note, "updatedAt" | "imageCount" | "sharing">;
    const plain = new Map<string, Plain>();
    let chunk: SealedNoteImport[] = [];
    let chunkBytes = 0;
    /** Ids the server said belong to someone else's note. */
    const taken: string[] = [];
    const send = async () => {
      if (chunk.length === 0) return;
      const body = { notes: chunk };
      chunk = [];
      chunkBytes = 0;
      const res = await fetch(`${this.baseUrl}/api/notes/import`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) await this.fail(res, "Failed to import notes");
      try {
        const answer = (await res.json()) as Partial<NotesImportResponse>;
        taken.push(...(answer.taken ?? []));
      } catch {
        // No answer to read: nothing was said to be taken.
      }
    };
    const add = async (id: string, payload: Plain) => {
      const { id: _id, createdAt, ...fields } = payload;
      const item: SealedNoteImport = {
        ...(await sealing.sealOver(id, fields)),
        createdAt,
      };
      const bytes = textEncoder.encode(JSON.stringify(item)).length;
      if (
        chunk.length >= MAX_NOTES_PER_IMPORT ||
        chunkBytes + bytes > IMPORT_REQUEST_BYTES
      ) {
        await send();
      }
      chunk.push(item);
      chunkBytes += bytes;
    };
    for (const note of imported) {
      const {
        updatedAt: _updatedAt,
        imageCount: _imageCount,
        sharing: _sharing,
        ...payload
      } = note;
      const uploaded = await this.withUploads(payload);
      plain.set(uploaded.id, uploaded);
      await add(uploaded.id, uploaded);
    }
    await send();
    // An id that is someone else's note: sealed again under an id of this
    // device's making, since a sealed note cannot be given one by the server.
    const again = taken.splice(0);
    for (const id of again) {
      sealing.forget(id);
      const payload = plain.get(id);
      if (payload) await add(ulid(), payload);
    }
    await send();
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
}
