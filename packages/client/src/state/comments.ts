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

function report(context: string, err: unknown, fallback: MessageKey): void {
  console.error("%s", context, err);
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 401) return; // signed out; the login screen says enough
  showError(t(status === 409 ? "comments.error.full" : fallback));
}

/**
 * A comment the server sent, from a reply or the socket: added, or put in the
 * place of the copy held. Ignored for a note whose comments are not loaded,
 * which will ask for all of them when it is opened.
 */
export function receiveComment(comment: NoteComment): void {
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
  const held = noteComments.value.get(noteId);
  if (!held) return;
  setFor(
    noteId,
    held.filter((c) => c.id !== id),
  );
}

/** Drops what is held for a note, when its panel goes away. */
export function forgetComments(noteId: string): void {
  if (noteComments.value.has(noteId)) setFor(noteId, null);
}

export async function loadComments(noteId: string): Promise<boolean> {
  try {
    const body = await apiJson<NoteCommentsResponse>(
      "GET",
      `/notes/${noteId}/comments`,
    );
    setFor(noteId, body?.comments ?? []);
    return true;
  } catch (err) {
    // Quietly: the note is what was opened, and the panel says it could not
    // load rather than a toast arriving over the editor.
    console.error(`Failed to load comments of ${noteId}:`, err);
    return false;
  }
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
