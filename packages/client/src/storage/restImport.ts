import {
  MAX_NOTES_PER_IMPORT,
  type Note,
  type NotesImportResponse,
  type NoteUpdate,
  type SealedNote,
  type SealedNoteImport,
} from "@manifesto/shared";
import { ulid } from "ulid";
import type { NoteSealing } from "./sealing.ts";

/**
 * Under the 1 MiB body limit of the server, with space for the own wrapping of
 * the request.
 */
const IMPORT_REQUEST_BYTES = 900 * 1024;

const textEncoder = new TextEncoder();

/** What `importNotes` needs of `RestApiAdapter`. */
export interface ImportRequests {
  sealing: NoteSealing;
  /** Opens the full listing. Thus, the key of each note is held. */
  loadAll: () => Promise<unknown>;
  /** Uploads the images inside a note, and answers it with references. */
  withUploads: <T extends NoteUpdate>(note: T) => Promise<T>;
  /** The note as the server has it now, or null. */
  fetchSealed: (id: string) => Promise<SealedNote | null>;
  /** Sends one part of the import. Rejects for a refusal. */
  post: (body: {
    notes: SealedNoteImport[];
  }) => Promise<Partial<NotesImportResponse>>;
}

/**
 * Sends a backup in as few requests as the limits of the server permit. Each
 * note keeps its id and creation time. Thus, the server updates the notes
 * that it already has, and an import of the same file two times changes
 * nothing.
 */
export async function importNotes(
  imported: Note[],
  adapter: ImportRequests,
): Promise<void> {
  const { sealing } = adapter;
  // A note that this account already has is written over under its current
  // key. Thus, each key must be available before the first is sealed.
  if (!sealing.complete) await adapter.loadAll();
  type Plain = Omit<Note, "updatedAt" | "imageCount" | "sharing">;
  const plain = new Map<string, Plain>();
  let chunk: SealedNoteImport[] = [];
  let chunkBytes = 0;
  /** Ids that the server said belong to the note of a different person. */
  const taken: string[] = [];
  /**
   * Ids of notes that the server has under a key different from the key with
   * which they came.
   */
  const stale: string[] = [];
  const send = async () => {
    if (chunk.length === 0) return;
    const body = { notes: chunk };
    chunk = [];
    chunkBytes = 0;
    const answer = await adapter.post(body);
    taken.push(...(answer.taken ?? []));
    stale.push(...(answer.stale ?? []));
  };
  /** Ids whose key this import made, not a key that the device had. */
  const madeHere = new Set<string>();
  const add = async (id: string, payload: Plain) => {
    const { id: _id, createdAt, ...fields } = payload;
    if (!sealing.holds(id)) madeHere.add(id);
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
    const uploaded = await adapter.withUploads(payload);
    plain.set(uploaded.id, uploaded);
    await add(uploaded.id, uploaded);
  }
  await send();
  // An id that is the note of a different person. Sealed again under an id
  // that this device makes, because the server cannot give a sealed note an
  // id.
  const again = taken.splice(0);
  for (const id of again) {
    // A key that this import made for the id is not a key of that note. A key
    // that the device had (a note shared with the account) still is.
    if (madeHere.has(id)) sealing.forget(id);
    const payload = plain.get(id);
    if (payload) await add(ulid(), payload);
  }
  await send();
  // A note whose key was replaced since this device read it. Read again,
  // which takes its current key, and sealed under that.
  const behind = stale.splice(0);
  for (const id of behind) {
    const now = await adapter.fetchSealed(id);
    if (!now || !(await sealing.open(now))) {
      throw new Error("Failed to import notes");
    }
    const payload = plain.get(id);
    if (payload) await add(id, payload);
  }
  await send();
  // Still under a different key: it was replaced again, or this device cannot
  // have the key of the note. The code tells this, and does not skip it.
  if (stale.length > 0) throw new Error("Failed to import notes");
}
