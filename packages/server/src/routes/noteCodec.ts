import {
  type AccountSealKeys,
  type Note,
  type NoteCreate,
  NoteLimitError,
  type NoteSealKey,
  type NoteUpdate,
  type NoteVersion,
  noteSealKey,
  openComment,
  openNoteKey,
  openPreviousKeys,
  openSealedNote,
  openVersion,
  type SealedNote,
  type SealedNoteVersion,
  sealComment,
  sealNewNote,
  sealNoteUpdate,
  sealVersion,
  wipe,
} from "@manifesto/shared";
import type { Context } from "hono";
import type { z } from "zod";
import { newId } from "../lib/ulid.js";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import {
  commentTextSchema,
  noteCommentCreateSchema,
  noteCommentSchema,
  noteCreateSchema,
  notesImportSchema,
  noteUpdateSchema,
  noteVersionCreateSchema,
  sealedNoteCreateSchema as sealedCreate,
  type sealedNoteCreateSchema,
  sealedNotesImportSchema,
  type sealedNoteUpdateSchema,
  sealedNoteUpdateSchema as sealedUpdate,
  sealedVersionCreateSchema,
} from "../validation/schemas.js";

/**
 * Notes for a token that carries a key
 * (`docs/specification/features/encryption.md`, "Tokens that carry a key").
 *
 * The app sends and is sent sealed notes, and the routes store what they are
 * given. A script cannot seal or open one, so for a request that presents a
 * token the server does it, with the keys the token carries, in memory, for
 * that request: readable notes in, readable notes out, the same sealed rows
 * in between. Everything here is that translation, so a route does one thing
 * whoever is asking.
 */

type Ctx = Context<{ Variables: { auth: AuthContext } }>;

type SealedCreate = z.infer<typeof sealedNoteCreateSchema>;
type SealedUpdate = z.infer<typeof sealedNoteUpdateSchema>;
type SealedImportItem = z.infer<
  typeof sealedNotesImportSchema
>["notes"][number];

/**
 * The keys of the token making this request, or null for the app's own
 * session, which is answered sealed. A token that carries none (one made for
 * the account routes alone) is refused: it has nothing to open a note with.
 */
export function tokenKeys(c: Ctx): AccountSealKeys | null {
  const auth = c.get("auth");
  if (auth.via === "session") return null;
  if (!auth.keys) {
    throw new HttpError(
      403,
      "This token carries no key, so it cannot read or write notes",
    );
  }
  return auth.keys;
}

/** A request body held to `schema`, refused as the validator refuses one. */
export async function bodyOf<S extends z.ZodType>(
  c: Ctx,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "Malformed JSON in request body");
  }
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  const path = first?.path.length ? `${first.path.join(".")}: ` : "";
  throw new HttpError(
    422,
    `${path}${first?.message ?? "Invalid request body"}`,
  );
}

/** What sealing refuses (a title too long, an image with no key) is the
 * caller's to fix, as a validation failure is. */
async function sealing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof NoteLimitError) throw new HttpError(422, err.message);
    throw err;
  }
}

/** A note as this request is answered: sealed for the app, opened for a
 * token. Null when the token's keys do not open it. */
export async function noteOut(
  keys: AccountSealKeys | null,
  sealed: SealedNote,
): Promise<SealedNote | Note | null> {
  if (!keys) return sealed;
  return (await openSealedNote(keys, sealed))?.note ?? null;
}

/** A listing, the same way; a note the token cannot open is left out. */
export async function notesOut(
  keys: AccountSealKeys | null,
  sealed: SealedNote[],
): Promise<(SealedNote | Note)[]> {
  if (!keys) return sealed;
  const out: Note[] = [];
  for (const note of sealed) {
    const opened = await openSealedNote(keys, note);
    if (opened) out.push(opened.note);
  }
  return out;
}

/** The new note in a request, sealed: as the app sent it, or sealed here
 * under an id of the server's choosing for a token. */
export async function createBody(
  c: Ctx,
  keys: AccountSealKeys | null,
): Promise<SealedCreate> {
  if (!keys) return bodyOf(c, sealedCreate);
  const plain = await bodyOf(c, noteCreateSchema);
  return sealedFrom(keys, newId(), plain as Omit<NoteCreate, "trashedAt">);
}

async function sealedFrom(
  keys: AccountSealKeys,
  id: string,
  plain: Omit<NoteCreate, "trashedAt">,
): Promise<SealedCreate> {
  const { sealed } = await sealing(() =>
    // A new note names no image: a token has no key for one to carry.
    sealNewNote(keys, id, { ...plain, trashedAt: null }),
  );
  const { trashedAt: _trashedAt, ...body } = sealed;
  return body as SealedCreate;
}

/**
 * The changes in a request, sealed. For a token they are sealed under the
 * key the note has, which takes reading the note first: null when there is
 * no such note for this account.
 */
export async function updateBody(
  c: Ctx,
  keys: AccountSealKeys | null,
  storage: StorageDriver,
  id: string,
): Promise<SealedUpdate | null> {
  if (!keys) return bodyOf(c, sealedUpdate);
  const plain = await bodyOf(c, noteUpdateSchema);
  return sealedChanges(keys, storage, id, plain as NoteUpdate);
}

async function sealedChanges(
  keys: AccountSealKeys,
  storage: StorageDriver,
  id: string,
  plain: NoteUpdate,
): Promise<SealedUpdate | null> {
  const current = await storage.notes.getById(id, keys.userId);
  if (!current) return null;
  const opened = await openSealedNote(keys, current);
  if (!opened) {
    throw new HttpError(409, "This token cannot open the note's key");
  }
  // The images the note already names keep their keys; a new one has none
  // here, and sealing refuses it.
  const sealed = await sealing(() =>
    sealNoteUpdate(keys, opened.key, id, plain, opened.imageKeys),
  );
  const {
    trashedAt: _t,
    updatedAt: _u,
    key: _k,
    keyVersion: _v,
    ...body
  } = sealed;
  return body as SealedUpdate;
}

/**
 * The notes of an import, sealed. For a token, a note the account already
 * owns is written over under the key it has, and any other under a new key
 * and, when its id is taken or missing, a new id.
 */
export async function importBody(
  c: Ctx,
  keys: AccountSealKeys | null,
  storage: StorageDriver,
): Promise<SealedImportItem[]> {
  if (!keys) return (await bodyOf(c, sealedNotesImportSchema)).notes;
  const { notes } = await bodyOf(c, notesImportSchema);
  const out: SealedImportItem[] = [];
  for (const { id, createdAt, ...plain } of notes) {
    const stamp = createdAt !== undefined ? { createdAt } : {};
    const access = id ? await storage.notes.access(id, keys.userId) : null;
    if (id && access) {
      const current = await storage.notes.getById(id, keys.userId);
      const changes =
        access.role === "owner"
          ? await sealedChanges(keys, storage, id, plain as NoteUpdate)
          : null;
      // A shared note is skipped by the route; it needs only to name it.
      out.push({
        ...(changes ?? {}),
        id,
        key: current?.key ?? "",
        keyVersion: current?.keyVersion ?? 1,
        ...stamp,
      } as SealedImportItem);
      continue;
    }
    const free = id !== undefined && !(await storage.notes.exists(id));
    out.push({
      ...(await sealedFrom(keys, free ? id : newId(), plain)),
      ...stamp,
    });
  }
  return out;
}

/** A note's versions as this request is answered. */
export async function versionsOut(
  keys: AccountSealKeys | null,
  note: SealedNote,
  sealed: SealedNoteVersion[],
): Promise<(SealedNoteVersion | NoteVersion)[]> {
  if (!keys) return sealed;
  const opened = await openSealedNote(keys, note);
  if (!opened) return [];
  const out: NoteVersion[] = [];
  for (const version of sealed) {
    const plain = await openVersion(opened.key, version);
    if (plain) out.push(plain);
  }
  return out;
}

/** The version in a request, sealed; null for a token whose keys do not
 * open the note. */
export async function versionBody(
  c: Ctx,
  keys: AccountSealKeys | null,
  note: SealedNote,
): Promise<z.infer<typeof sealedVersionCreateSchema> | null> {
  if (!keys) return bodyOf(c, sealedVersionCreateSchema);
  const plain = await bodyOf(c, noteVersionCreateSchema);
  const opened = await openSealedNote(keys, note);
  if (!opened) return null;
  const id = newId();
  return {
    id,
    ...(await sealing(() => sealVersion(opened.key, id, plain))),
    ...(plain.timestamp !== undefined && { timestamp: plain.timestamp }),
  };
}

/** A note's key and the ones it was under before, as a token opens them. */
export interface NoteRing {
  key: NoteSealKey;
  older: Map<number, NoteSealKey>;
}

/**
 * The keys of a note the token's account holds, for what is written beside
 * the note under them (its comments). 404 when the account cannot see the
 * note, 409 when the token's keys do not open it.
 */
export async function noteRing(
  keys: AccountSealKeys,
  storage: StorageDriver,
  noteId: string,
): Promise<NoteRing> {
  const note = await storage.notes.getById(noteId, keys.userId);
  if (!note) throw new HttpError(404, "Note not found");
  const key = await openNoteKey(keys, noteId, note.keyVersion, note.key);
  if (!key) throw new HttpError(409, "This token cannot open the note's key");
  const older = new Map<number, NoteSealKey>();
  const raws = await openPreviousKeys(key, noteId, note.previousKeys);
  for (const [version, raw] of raws) {
    older.set(version, await noteSealKey(raw, version));
    wipe(raw);
  }
  return { key, older };
}

/** A comment's text as a token reads it; null for one that does not open. */
export async function commentOut(
  ring: NoteRing,
  comment: { id: string; keyVersion: number; body: string },
): Promise<string | null> {
  const key =
    comment.keyVersion === ring.key.version
      ? ring.key
      : ring.older.get(comment.keyVersion);
  return key ? openComment(key, comment) : null;
}

/**
 * The comment in a request, sealed: as the app sent it, under the id it
 * chose, or sealed here for a token under the note's key. `id` is the
 * comment being changed, absent for a new one.
 */
export async function commentBody(
  c: Ctx,
  ring: NoteRing | null,
  id?: string,
): Promise<{ id: string; body: string; keyVersion: number }> {
  if (!ring) {
    if (id === undefined) return bodyOf(c, noteCommentCreateSchema);
    return { id, ...(await bodyOf(c, noteCommentSchema)) };
  }
  const plain = await bodyOf(c, commentTextSchema);
  const commentId = id ?? newId();
  return {
    id: commentId,
    ...(await sealing(() => sealComment(ring.key, commentId, plain.body))),
  };
}
