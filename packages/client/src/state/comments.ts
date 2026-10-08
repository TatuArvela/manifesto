import type {
  NoteComment,
  NoteCommentResponse,
  NoteCommentsResponse,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { t } from "../i18n/index.js";
import type { MessageKey } from "../i18n/messages/index.js";
import { ApiError, apiJson } from "../storage/apiRequest.js";
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
 * A comment the server sent, from a reply or the socket: added, or put in the
 * place of the copy held. Ignored for a note whose comments are not loaded,
 * which will ask for all of them when it is opened.
 */
export function receiveComment(comment: NoteComment): void {
  reloadIfLoading(comment.noteId);
  const held = noteComments.value.get(comment.noteId);
  if (!held) return;
  setFor(
    comment.noteId,
    held.some((c) => c.id === comment.id)
      ? held.map((c) => (c.id === comment.id ? comment : c))
      : [...held, comment],
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
    if (!current()) return true;
    loading.delete(noteId);
    setFor(noteId, body?.comments ?? []);
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
    const res = await apiJson<NoteCommentResponse>(
      "POST",
      `/notes/${noteId}/comments`,
      { body },
    );
    if (res) receiveComment(res.comment);
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
    const res = await apiJson<NoteCommentResponse>(
      "PUT",
      `/notes/${comment.noteId}/comments/${comment.id}`,
      { body },
    );
    if (res) receiveComment(res.comment);
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
