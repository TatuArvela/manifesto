import type {
  AttachmentsClaimRequest,
  AttachmentsClaimResponse,
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
  SealedNoteVersion,
  SyncResponse,
} from "@manifesto/shared";
import {
  attachmentIdOf,
  isAttachmentRef,
  mapPreviewImages,
  NewerNoteFormatError,
  previewImages,
} from "@manifesto/shared";
import { ulid } from "ulid";
import { dataUrlToBlob } from "#/utils/dataUrl.ts";
import {
  errorMessage,
  ImageUploadError,
  NoteConflictError,
  RequestError,
  refusalCode,
} from "./restErrors.ts";
import { importNotes } from "./restImport.ts";
import type {
  CreateOptions,
  NoteChanges,
  StorageAdapter,
  VersionInput,
} from "./StorageAdapter.ts";
import type { NoteSealing } from "./sealing.ts";
import { LockedError } from "./storageKeys.ts";

export interface RestApiAdapterOptions {
  /** Called when the server returns 401, before the error is thrown. */
  onUnauthorized?: (() => void) | undefined;
  /**
   * Seals what is sent, and opens what arrives. Null while the account is
   * locked. Then nothing that contains the words of a note can be read or
   * written.
   */
  sealer?: NoteSealing | null | undefined;
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

  /** The sealing of the account, or a refusal while it is locked. */
  private sealing(): NoteSealing {
    if (!this.sealer) throw new LockedError();
    return this.sealer;
  }

  /** A note as the server keeps it, for a key that this device did not open. */
  private readonly sealedNote = (id: string) => async () => {
    const res = await fetch(`${this.baseUrl}/api/v1/notes/${id}`, {
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
    let data: Partial<ErrorResponse> = {};
    try {
      data = (await res.json()) as Partial<ErrorResponse>;
    } catch {
      // The body was not JSON. Keep the fallback message.
    }
    if (data.code === "note_format_newer") throw new NewerNoteFormatError();
    throw new RequestError(res.status, errorMessage(data, fallback));
  }

  /**
   * All pages of a listing, joined.
   *
   * The app keeps all notes of a user in one signal (`filteredNotes`, `allTags`
   * and the tag counts are computed over the full list). Thus, pages are a
   * property of the wire, not of the model. They limit each single response,
   * and do not change what the client has. The notes come back without their
   * attachments. `loadImages` loads those for the one note that needs them.
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
      // An empty page cannot have a useful page after it.
      if (data.notes.length === 0) break;
      const next = data.nextCursor ?? null;
      // A server that continued to give back the same cursor would loop here.
      if (next !== null && next === cursor) throw new Error(failure);
      cursor = next;
    } while (cursor !== null);
    return notes;
  }

  async getAll(): Promise<Note[]> {
    const notes = await this.drainPages(
      "/api/v1/notes",
      "Failed to fetch notes",
    );
    this.sealer?.markComplete();
    return notes;
  }

  /**
   * All pages of one sync. The checkpoint and the ids come on the last page,
   * and the server sets the checkpoint when the client asks for the first page.
   *
   * A server from before `/api/v1/sync` answers 404. The client reads that as a
   * server that keeps no record of changes. The caller then lists all notes, as
   * it did then.
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
      const res: Response = await fetch(
        `${this.baseUrl}/api/v1/sync${search}`,
        {
          headers: this.headers(),
        },
      );
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
      // A cursor given back without change would loop here, as in `drainPages`.
      if (data.nextCursor === cursor) throw new Error("Sync did not advance");
      cursor = data.nextCursor;
    }
  }

  /**
   * The images of one note. A listing carries them now. Thus, this is a read of
   * the note for a caller that still asks.
   */
  async loadImages(id: string): Promise<string[]> {
    const note = await this.get(id);
    return note?.images ?? [];
  }

  async listVersions(noteId: string): Promise<NoteVersion[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/notes/${noteId}/versions`, {
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

  async saveVersion(noteId: string, version: VersionInput): Promise<void> {
    const sealed = await this.sealing().sealVersion(
      noteId,
      version,
      this.sealedNote(noteId),
    );
    const res = await fetch(`${this.baseUrl}/api/v1/notes/${noteId}/versions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(sealed),
    });
    if (!res.ok) await this.fail(res, "Failed to save version");
  }

  async loadImage(ref: string): Promise<Blob> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/attachments/${attachmentIdOf(ref)}`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    if (!res.ok) await this.fail(res, "Failed to fetch attachment");
    return await this.sealing().openDownload(ref, await res.blob());
  }

  async get(id: string): Promise<Note | null> {
    const sealing = this.sealing();
    const sealed = await this.sealedNote(id)();
    return sealed ? await sealing.open(sealed) : null;
  }

  /**
   * The note in an answer, opened. A note that does not open is a failed
   * request, because the caller asked for it when it wrote it.
   */
  private async opened(res: Response, failure: string): Promise<Note> {
    const data = (await res.json()) as NoteResponse<SealedNote>;
    const note = await this.sealing().open(data.note);
    if (!note) throw new Error(failure);
    return note;
  }

  /**
   * Seals one image, uploads it, and resolves its `attachment:` reference.
   * Through `XMLHttpRequest`, not `fetch`, because only it reports how much of
   * the body went.
   */
  async putImage(
    image: Blob,
    options: {
      onProgress?: (fraction: number) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<string> {
    const sealing = this.sealing();
    const upload = await sealing.sealUpload(image);
    const ref = await this.send(upload.body, upload.headers, options);
    sealing.keepImageKey(ref, upload.key);
    return ref;
  }

  private send(
    body: Blob,
    headers: Record<string, string>,
    options: {
      onProgress?: (fraction: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // An `abort` listener never gets a signal that already fired.
      if (options.signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${this.baseUrl}/api/v1/attachments`);
      xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
      for (const [name, value] of Object.entries(headers)) {
        xhr.setRequestHeader(name, value);
      }
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
      xhr.send(body);
    });
  }

  /**
   * Makes the images that a note will name belong to its owner, and answers the
   * reference to name for each. All attachments of a note belong to its owner,
   * and nobody can change one under a sealed note. Thus, an image that a
   * different person has (the own upload of an editor, an image copied out of a
   * shared note) is first stored again for the owner.
   */
  private async claim(
    refs: string[],
    noteId: string | undefined,
  ): Promise<Map<string, string>> {
    const sealing = this.sealing();
    const claimed = new Map<string, string>();
    const asked = [...new Set(refs)];
    if (!sealing.claimsImages || asked.length === 0) return claimed;
    const body: AttachmentsClaimRequest = {
      ...(noteId !== undefined && { noteId }),
      refs: asked,
    };
    const res = await fetch(`${this.baseUrl}/api/v1/attachments/claim`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) await this.fail(res, "Failed to store the note's images");
    const answer = (await res.json()) as AttachmentsClaimResponse;
    asked.forEach((ref, i) => {
      const owned = answer.refs[i];
      if (owned === undefined || owned === ref) return;
      claimed.set(ref, owned);
      sealing.sameImage(ref, owned);
    });
    return claimed;
  }

  /**
   * Each image that is still inline, uploaded and replaced by its reference. A
   * note write carries only references. The editor uploads when images are
   * attached. This catches the remaining images (an import, something shared to
   * the app).
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
   * The same for link preview images. The code drops an image that does not
   * upload and keeps the card, because the server refuses a preview image that
   * is inline.
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

  /**
   * A note write, with all inline data uploaded first, and with each image that
   * it names made the property of the owner of note `noteId` (the own images of
   * the writer, for a note that does not exist yet).
   */
  private async withUploads<T extends NoteUpdate>(
    changes: T,
    noteId?: string,
  ): Promise<T> {
    if (!changes.images && !changes.linkPreviews) return changes;
    const images = changes.images
      ? await this.uploadInline(changes.images)
      : undefined;
    const linkPreviews = changes.linkPreviews
      ? await this.uploadInlinePreviews(changes.linkPreviews)
      : undefined;
    const owned = await this.claim(
      [...(images ?? []), ...previewImages(linkPreviews ?? [])].filter(
        isAttachmentRef,
      ),
      noteId,
    );
    const own = (ref: string) => owned.get(ref) ?? ref;
    return {
      ...changes,
      ...(images && { images: images.map(own) }),
      ...(linkPreviews && {
        linkPreviews: await mapPreviewImages(linkPreviews, async (image) =>
          own(image),
        ),
      }),
    };
  }

  async create(note: NoteCreate, options: CreateOptions = {}): Promise<Note> {
    const sealing = this.sealing();
    // The id is selected on this side. All sealed data is bound to it.
    const sealed = await sealing.sealNew(
      options.id ?? ulid(),
      await this.withUploads(note),
    );
    const res = await fetch(`${this.baseUrl}/api/v1/notes`, {
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
    const withUploads = await this.withUploads(changes, id);
    const send = async () =>
      fetch(`${this.baseUrl}/api/v1/notes/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(
          await sealing.sealUpdate(id, withUploads, this.sealedNote(id)),
        ),
      });
    let res = await send();
    if (res.status === 409) {
      // The key of the note was replaced since this device last read it. It is
      // sealed again under its current key, one time. Read through `open`,
      // which takes the key that a recipient was offered. A recipient who has
      // none yet has no key after it, and the write fails, as it must. When a
      // newer app saved the note, that is not a reason to try again. A read of
      // it only marks it as a note that this build cannot show.
      const newer = (await refusalCode(res.clone())) === "note_format_newer";
      const now = await this.sealedNote(id)();
      if (now) await sealing.open(now);
      else sealing.forget(id);
      if (!newer) res = await send();
    }
    if (res.status === 412) {
      // The body is read one time, for the note and also for the message.
      let data: Partial<NoteResponse<SealedNote> & ErrorResponse> = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        // not JSON: nothing with which to merge, and no message
      }
      const current = data.note ? await sealing.open(data.note) : null;
      if (current) throw new NoteConflictError(current);
      throw new Error(errorMessage(data, "Failed to update note"));
    }
    if (!res.ok) await this.fail(res, "Failed to update note");
    return await this.opened(res, "Failed to update note");
  }

  async delete(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/notes/${id}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) await this.fail(res, "Failed to delete note");
    this.sealer?.forget(id);
  }

  async deleteAll(): Promise<void> {
    // The server deletes the notes that this user owns. The notes shared with
    // them belong to other persons.
    const res = await fetch(`${this.baseUrl}/api/v1/notes`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) await this.fail(res, "Failed to delete notes");
  }
  /**
   * Sends a backup in as few requests as the limits of the server permit. Each
   * note keeps its id and creation time. Thus, the server updates the notes
   * that it already has, and an import of the same file two times changes
   * nothing.
   */
  async importAll(imported: Note[]): Promise<void> {
    await importNotes(imported, {
      sealing: this.sealing(),
      loadAll: () => this.getAll(),
      withUploads: (note) => this.withUploads(note),
      fetchSealed: (id) => this.sealedNote(id)(),
      post: async (body) => {
        const res = await fetch(`${this.baseUrl}/api/v1/notes/import`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
        });
        if (!res.ok) await this.fail(res, "Failed to import notes");
        try {
          return (await res.json()) as Partial<NotesImportResponse>;
        } catch {
          // No answer to read: the server said that nothing was taken.
          return {};
        }
      },
    });
  }

  async fetchLinkPreview(url: string): Promise<LinkPreview | null> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/link-preview?url=${encodeURIComponent(url)}`,
      { headers: this.headers() },
    );
    // Previews are off on this server: the plain card is the answer.
    if (res.status === 404) return null;
    if (!res.ok) await this.fail(res, "Failed to fetch link preview");
    const data = (await res.json()) as LinkPreviewResponse;
    return data.preview;
  }
}
