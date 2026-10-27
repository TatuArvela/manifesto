import {
  type AccountSealKeys,
  attachmentIdOf,
  carriedImageAlts,
  currentNoteFormat,
  type ImageKey,
  isAttachmentRef,
  mapPreviewImages,
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
  previewImages,
  SEALED_SHARED_NOTE_FIELDS,
  type SealedNote,
  type SealedNoteVersion,
  sealComment,
  sealNewNote,
  sealNoteUpdate,
  sealVersion,
  unwrapImageKey,
  wipe,
  withEveryWord,
} from "@manifesto/shared";
import type { Context } from "hono";
import type { z } from "zod";
import { adoptImages } from "#/attachments/store.ts";
import { nowIso } from "#/lib/time.ts";
import { newId } from "#/lib/ulid.ts";
import type { AuthContext } from "#/middleware/authBearer.ts";
import { HttpError } from "#/middleware/error.ts";
import type { StorageDriver } from "#/storage/types.ts";
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
} from "#/validation/noteSchemas.ts";

/**
 * Notes for a token that carries a key
 * (`docs/specification/features/encryption.md`, "Tokens that carry a key").
 *
 * The app sends and gets sealed notes, and the routes store what they get. A
 * script cannot seal or open a note. Thus, for a request with a token, the
 * server does it, with the keys of the token, in memory, for that request:
 * readable notes in, readable notes out, and the same sealed rows between them.
 * All code here is that translation. Thus, a route does one thing, whoever
 * asks.
 */

type Ctx = Context<{ Variables: { auth: AuthContext } }>;

type SealedCreate = z.infer<typeof sealedNoteCreateSchema>;
type SealedUpdate = z.infer<typeof sealedNoteUpdateSchema>;
type SealedImportItem = z.infer<
  typeof sealedNotesImportSchema
>["notes"][number];

/**
 * The keys of the token of this request, or null for the own session of the
 * app, which gets sealed answers. The server refuses a token that has no keys
 * (a token made only for the account routes), because it has nothing with which
 * to open a note.
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

/**
 * A request body checked against `schema`, refused as the validator refuses
 * one.
 */
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

/**
 * What the seal refuses (a title that is too long, an image without a key) the
 * caller must correct, as for a validation failure.
 */
async function sealing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof NoteLimitError) throw new HttpError(422, err.message);
    throw err;
  }
}

/**
 * A note as this request gets it: sealed for the app, opened for a token. Null
 * when the keys of the token do not open it.
 */
export async function noteOut(
  keys: AccountSealKeys | null,
  sealed: SealedNote,
): Promise<SealedNote | Note | null> {
  if (!keys) return sealed;
  return (await openSealedNote(keys, sealed))?.note ?? null;
}

/**
 * A listing, in the same way. The code skips a note that the token cannot open.
 */
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

/**
 * The new note in a request, sealed: as the app sent it, or sealed here under
 * an id that the server selects, for a token.
 */
export async function createBody(
  c: Ctx,
  keys: AccountSealKeys | null,
  storage: StorageDriver,
): Promise<SealedCreate> {
  if (!keys) return bodyOf(c, sealedCreate);
  const plain = await bodyOf(c, noteCreateSchema);
  return sealedFrom(
    keys,
    storage,
    newId(),
    plain as Omit<NoteCreate, "trashedAt">,
  );
}

/**
 * The keys of the images that the note of a token names, for the images that
 * the token uploaded. The server kept each one wrapped under the notes key of
 * the account, with the attachment (`POST /api/v1/attachments`). From here, it
 * is sealed into the note. The code leaves a reference without such a key to
 * the seal, which refuses it.
 */
async function uploadedKeys(
  keys: AccountSealKeys,
  storage: StorageDriver,
  note: Pick<Partial<NoteCreate>, "images" | "linkPreviews">,
  known: ReadonlyMap<string, ImageKey> = new Map(),
): Promise<Map<string, ImageKey>> {
  const out = new Map(known);
  const refs = [
    ...(note.images ?? []),
    ...previewImages(note.linkPreviews ?? []),
  ];
  for (const ref of refs) {
    if (out.has(ref) || !isAttachmentRef(ref)) continue;
    const id = attachmentIdOf(ref);
    const meta = await storage.attachments.meta(id);
    const key = await unwrapImageKey(keys, id, meta?.wrappedKey);
    if (key) out.set(ref, key);
  }
  return out;
}

/**
 * The changes, with each image that they name given to the owner of the note,
 * as the app does before it seals (`POST /api/v1/attachments/claim`). The token
 * of an editor names its own upload, and the write accepts only the reference
 * of the owner. The copy contains the same bytes. Thus, the key kept with the
 * upload opens it. The key goes into `imageKeys` under the reference that the
 * note will name.
 */
async function ownedByOwner(
  storage: StorageDriver,
  owner: { ownerId: string; writerId: string },
  plain: NoteUpdate,
  imageKeys: Map<string, ImageKey>,
): Promise<NoteUpdate> {
  const named = [
    ...(plain.images ?? []),
    ...previewImages(plain.linkPreviews ?? []),
  ];
  if (named.length === 0) return plain;
  const now = nowIso();
  const owned = new Map<string, string>();
  for (const ref of new Set(named)) {
    const [own = ref] = await adoptImages(
      storage,
      [ref],
      owner.ownerId,
      owner.writerId,
      now,
    );
    owned.set(ref, own);
    const key = imageKeys.get(ref);
    if (key) imageKeys.set(own, key);
  }
  const ownerOf = (ref: string) => owned.get(ref) ?? ref;
  return {
    ...plain,
    ...(plain.images && { images: plain.images.map(ownerOf) }),
    ...(plain.linkPreviews && {
      linkPreviews: await mapPreviewImages(plain.linkPreviews, async (ref) =>
        ownerOf(ref),
      ),
    }),
  };
}

async function sealedFrom(
  keys: AccountSealKeys,
  storage: StorageDriver,
  id: string,
  plain: Omit<NoteCreate, "trashedAt">,
): Promise<SealedCreate> {
  const imageKeys = await uploadedKeys(keys, storage, plain);
  const { sealed } = await sealing(() =>
    sealNewNote(keys, id, { ...plain, trashedAt: null }, imageKeys),
  );
  const { trashedAt: _trashedAt, ...body } = sealed;
  return body as SealedCreate;
}

/**
 * The changes in a request, sealed. For a token, they are sealed under the key
 * of the note. For that, the code must read the note first. Null when this
 * account has no such note.
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
  // A token cannot describe an image. But its new list of images keeps the
  // descriptions that the app gave them, each with its own image.
  const described =
    plain.images && opened.note.imageAlts
      ? { ...plain, imageAlts: carriedImageAlts(opened.note, plain.images) }
      : plain;
  // The images that the note already names keep their keys. An image that the
  // token uploaded brings the key kept with it. All other images have no key
  // here, and the seal refuses them.
  const imageKeys = await uploadedKeys(keys, storage, plain, opened.imageKeys);
  // A note stored in an older format moves to this format with all of its words
  // at the same time. The words that did not change go as they were opened.
  const whole =
    current.format < currentNoteFormat()
      ? withEveryWord(opened.note, described)
      : described;
  // On a note shared with the account of the token, they first go to the owner.
  // The images of a viewer stay as they are, so that the route can refuse them.
  const access = await storage.notes.access(id, keys.userId);
  const changes =
    access?.role === "edit"
      ? await ownedByOwner(
          storage,
          { ownerId: access.ownerId, writerId: keys.userId },
          whole,
          imageKeys,
        )
      : whole;
  const sealed = await sealing(() =>
    sealNoteUpdate(keys, opened.key, id, changes, imageKeys),
  );
  const {
    trashedAt: _t,
    updatedAt: _u,
    key: _k,
    keyVersion: _v,
    ...body
  } = sealed;
  // Words under the note key tell which key, as the words of the app do. Thus,
  // the server refuses the write if the note leaves that key before the write
  // completes.
  const shared = SEALED_SHARED_NOTE_FIELDS.some((field) => field in body);
  return (
    shared ? { ...body, keyVersion: opened.key.version } : body
  ) as SealedUpdate;
}

/**
 * The notes of an import, sealed. For a token, a note that the account already
 * owns is written over under its key. All other notes are written under a new
 * key and, when their id is taken or missing, a new id.
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
      // The route skips a shared note. It only needs to name it.
      out.push({
        ...(changes ?? {}),
        id,
        key: current?.key ?? "",
        keyVersion: current?.keyVersion ?? 1,
        format: changes?.format ?? current?.format ?? currentNoteFormat(),
        ...stamp,
      } as SealedImportItem);
      continue;
    }
    const free = id !== undefined && !(await storage.notes.exists(id));
    out.push({
      ...(await sealedFrom(keys, storage, free ? id : newId(), plain)),
      ...stamp,
    });
  }
  return out;
}

/** The versions of a note, as this request gets them. */
export async function versionsOut(
  keys: AccountSealKeys | null,
  note: SealedNote,
  sealed: SealedNoteVersion[],
): Promise<(SealedNoteVersion | NoteVersion)[]> {
  if (!keys) return sealed;
  // Each with the key under which it was written: that of the note, or a
  // previous key.
  const ring = await ringOf(keys, note);
  if (!ring) return [];
  const out: NoteVersion[] = [];
  for (const version of sealed) {
    const key = ringKey(ring, version.keyVersion);
    const opened = key ? await openVersion(key, version) : null;
    if (opened) {
      const { imageKeys: _keys, ...plain } = opened;
      out.push(plain);
    }
  }
  return out;
}

/**
 * The version in a request, sealed. Null for a token whose keys do not open the
 * note.
 */
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

/** The key of a note and its previous keys, as a token opens them. */
export interface NoteRing {
  key: NoteSealKey;
  older: Map<number, NoteSealKey>;
}

/**
 * The keys of a note of the account of the token, for what is written next to
 * the note under them (its comments). 404 when the account cannot see the note.
 * 409 when the keys of the token do not open it.
 */
export async function noteRing(
  keys: AccountSealKeys,
  storage: StorageDriver,
  noteId: string,
): Promise<NoteRing> {
  const note = await storage.notes.getById(noteId, keys.userId);
  if (!note) throw new HttpError(404, "Note not found");
  const ring = await ringOf(keys, note);
  if (!ring) throw new HttpError(409, "This token cannot open the note's key");
  return ring;
}

/**
 * The keys of a note as it was read. Null when the keys of the token do not
 * open it.
 */
async function ringOf(
  keys: AccountSealKeys,
  note: SealedNote,
): Promise<NoteRing | null> {
  const key = await openNoteKey(keys, note.id, note.keyVersion, note.key);
  if (!key) return null;
  const older = new Map<number, NoteSealKey>();
  const raws = await openPreviousKeys(key, note.id, note.previousKeys);
  for (const [version, raw] of raws) {
    older.set(version, await noteSealKey(raw, version));
    wipe(raw);
  }
  return { key, older };
}

function ringKey(ring: NoteRing, version: number): NoteSealKey | null {
  return version === ring.key.version
    ? ring.key
    : (ring.older.get(version) ?? null);
}

/**
 * The text of a comment as a token reads it. Null for a comment that does not
 * open.
 */
export async function commentOut(
  ring: NoteRing,
  comment: { id: string; keyVersion: number; body: string },
): Promise<string | null> {
  const key = ringKey(ring, comment.keyVersion);
  return key ? openComment(key, comment) : null;
}

/**
 * The comment in a request, sealed: as the app sent it, under the id that the
 * app selected, or sealed here for a token under the key of the note. `id` is
 * the comment that changes. Absent for a new comment.
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
