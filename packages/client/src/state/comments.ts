import type {
  NoteComment,
  NoteCommentResponse,
  NoteCommentsResponse,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { ulid } from "ulid";
import { t } from "../i18n/index.js";
import type { MessageKey } from "../i18n/messages/index.js";
import { ApiError, apiJson } from "../storage/apiRequest.js";
import { sealer } from "../storage/sealing.js";
import { sealedNote } from "../storage/shareKeys.js";
import { showError } from "./ui.js";

/**
 * Comments beside shared notes, in connected mode.
 *
 * Held per note and only for notes whose comments have been asked for: a
 * comment is not part of a note, so the board never loads them. Every action
 * follows the contract in `actions.ts`: it reports its own failure and
 * resolves, saying whether it worked in its return value.
 */

/** The comments of each note they were loaded for, oldest first. */
export const noteComments = signal<ReadonlyMap<string, NoteComment[]>>(
  new Map(),
);

function setFor(noteId: string, comments: NoteComment[] | null): void {
  const next = new Map(noteComments.value);
  if (comments === null) next.delete(noteId);
  else next.set(noteId, comments);
  noteComments.value = next;
}

/** The notes whose comments could not be loaded, until a load of them works. */
export const commentLoadsFailed = signal<ReadonlySet<string>>(new Set());

function setFailed(noteId: string, failed: boolean): void {
  if (commentLoadsFailed.value.has(noteId) === failed) return;
  const next = new Set(commentLoadsFailed.value);
  if (failed) next.add(noteId);
  else next.delete(noteId);
  commentLoadsFailed.value = next;
}

/** The notes whose panel is up: the only ones anything is held for. */
const watched = new Set<string>();
/** The latest load under way for a note. An older one's answer is dropped. */
const loading = new Map<string, number>();
let loads = 0;

function report(context: string, err: unknown, fallback: MessageKey): void {
  console.error("%s", context, err);
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 401) return; // signed out; the login screen says enough
  showError(t(status === 409 ? "comments.error.full" : fallback));
}

/**
 * A list being read may have been read before the event that just arrived,
 * and would then undo it when it lands: read again, which replaces that load.
 */
function reloadIfLoading(noteId: string): void {
  if (loading.has(noteId)) void loadComments(noteId);
}

/**
 * A comment the server sent, from a reply or the socket, sealed as it came:
 * opened, then added or put in the place of the copy held. Ignored for a note
 * whose comments are not loaded, which will ask for all of them when it is
 * opened, and for one that does not open. Never rejects.
 */
export async function receiveComment(sealed: NoteComment): Promise<void> {
  reloadIfLoading(sealed.noteId);
  if (!noteComments.value.has(sealed.noteId)) return;
  let comment: NoteComment | undefined;
  try {
    [comment] =
      (await sealer
        .peek()
        ?.openComments(sealed.noteId, [sealed], sealedNote(sealed.noteId))) ??
      [];
  } catch (err) {
    console.warn("Failed to open a comment:", err);
  }
  if (!comment) return;
  const opened = comment;
  const held = noteComments.value.get(sealed.noteId);
  if (!held) return;
  setFor(
    opened.noteId,
    held.some((c) => c.id === opened.id)
      ? held.map((c) => (c.id === opened.id ? opened : c))
      : [...held, opened],
  );
}

export function forgetComment(noteId: string, id: string): void {
  reloadIfLoading(noteId);
  const held = noteComments.value.get(noteId);
  if (!held) return;
  setFor(
    noteId,
    held.filter((c) => c.id !== id),
  );
}

/** Drops what is held for a note, when its panel goes away. */
export function forgetComments(noteId: string): void {
  watched.delete(noteId);
  loading.delete(noteId);
  setFailed(noteId, false);
  if (noteComments.value.has(noteId)) setFor(noteId, null);
}

/**
 * Reads a note's comments and holds them until `forgetComments`. Called again
 * for a note already held it replaces the list, which is how a panel catches
 * up. An answer that arrives after the panel went away, or after a later load
 * of the same note began, is dropped.
 */
export async function loadComments(noteId: string): Promise<boolean> {
  const load = ++loads;
  watched.add(noteId);
  loading.set(noteId, load);
  const current = () => loading.get(noteId) === load;
  try {
    const body = await apiJson<NoteCommentsResponse>(
      "GET",
      `/notes/${noteId}/comments`,
    );
    // Sealed under the note's key; one that does not open is left out.
    const opened =
      (await sealer
        .peek()
        ?.openComments(noteId, body?.comments ?? [], sealedNote(noteId))) ?? [];
    if (!current()) return true;
    loading.delete(noteId);
    setFor(noteId, opened);
    setFailed(noteId, false);
    return true;
  } catch (err) {
    // Quietly: the note is what was opened, and the panel says it could not
    // load rather than a toast arriving over the editor.
    console.error(`Failed to load comments of ${noteId}:`, err);
    if (current()) {
      loading.delete(noteId);
      // A list already held stays: a failed catch-up is no reason to lose it.
      setFailed(noteId, !noteComments.value.has(noteId));
    }
    return false;
  }
}

/** Reads again for every panel that is up, after a gap in the socket. */
export function reloadComments(): void {
  for (const noteId of watched) void loadComments(noteId);
}

export async function addComment(
  noteId: string,
  body: string,
): Promise<boolean> {
  try {
    const sealing = sealer.peek();
    if (!sealing) throw new ApiError(0);
    // The id is chosen here: the sealed text is bound to it.
    const id = ulid();
    const res = await apiJson<NoteCommentResponse>(
      "POST",
      `/notes/${noteId}/comments`,
      {
        id,
        ...(await sealing.sealComment(noteId, id, body, sealedNote(noteId))),
      },
    );
    if (res) await receiveComment(res.comment);
    return true;
  } catch (err) {
    report(`Failed to comment on ${noteId}:`, err, "comments.error.addFailed");
    return false;
  }
}

export async function editComment(
  comment: NoteComment,
  body: string,
): Promise<boolean> {
  try {
    // The same words again are no edit: sealed anew they would look like one.
    if (body.trim() === comment.body) return true;
    const sealing = sealer.peek();
    if (!sealing) throw new ApiError(0);
    const res = await apiJson<NoteCommentResponse>(
      "PUT",
      `/notes/${comment.noteId}/comments/${comment.id}`,
      await sealing.sealComment(
        comment.noteId,
        comment.id,
        body,
        sealedNote(comment.noteId),
      ),
    );
    if (res) await receiveComment(res.comment);
    return true;
  } catch (err) {
    report(
      `Failed to edit comment ${comment.id}:`,
      err,
      "comments.error.editFailed",
    );
    return false;
  }
}

export async function deleteComment(comment: NoteComment): Promise<boolean> {
  try {
    await apiJson("DELETE", `/notes/${comment.noteId}/comments/${comment.id}`);
    forgetComment(comment.noteId, comment.id);
    return true;
  } catch (err) {
    // Already gone is what was asked for.
    if (err instanceof ApiError && err.status === 404) {
      forgetComment(comment.noteId, comment.id);
      return true;
    }
    report(
      `Failed to delete comment ${comment.id}:`,
      err,
      "comments.error.deleteFailed",
    );
    return false;
  }
}
