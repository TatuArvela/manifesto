import type {
  NoteComment,
  NoteCommentResponse,
  NoteCommentsResponse,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { ulid } from "ulid";
import { t } from "#/i18n/index.ts";
import type { MessageKey } from "#/i18n/messages/index.ts";
import { ApiError, apiJson } from "#/storage/apiRequest.ts";
import { sealer } from "#/storage/sealing.ts";
import { sealedNote } from "#/storage/shareKeys.ts";
import { showError } from "./ui.ts";

/**
 * Comments next to shared notes, in connected mode.
 *
 * Kept for each note, and only for notes whose comments a panel asked for. A
 * comment is not part of a note. Thus, the board never loads them. Each action
 * follows the contract in `actions.ts`. It reports its own failure and
 * resolves, and its return value tells if it worked.
 */

/** The comments of each note for which they loaded, oldest first. */
export const noteComments = signal<ReadonlyMap<string, NoteComment[]>>(
  new Map(),
);

function setFor(noteId: string, comments: NoteComment[] | null): void {
  const next = new Map(noteComments.value);
  if (comments === null) next.delete(noteId);
  else next.set(noteId, comments);
  noteComments.value = next;
}

/** The notes whose comments did not load, until a load of them works. */
export const commentLoadsFailed = signal<ReadonlySet<string>>(new Set());

function setFailed(noteId: string, failed: boolean): void {
  if (commentLoadsFailed.value.has(noteId) === failed) return;
  const next = new Set(commentLoadsFailed.value);
  if (failed) next.add(noteId);
  else next.delete(noteId);
  commentLoadsFailed.value = next;
}

/** The notes whose panel is open: the only notes for which anything is kept. */
const watched = new Set<string>();
/**
 * The latest load in progress for a note. The code drops the answer of an older
 * load.
 */
const loading = new Map<string, number>();
let loads = 0;

function report(context: string, err: unknown, fallback: MessageKey): void {
  console.error("%s", context, err);
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 401) return; // signed out; the login screen tells sufficient
  showError(t(status === 409 ? "comments.error.full" : fallback));
}

/**
 * A list that is in a read can have been read before the event that just
 * arrived. It would then undo the event when it arrives. Thus, read again,
 * which replaces that load.
 */
function reloadIfLoading(noteId: string): void {
  if (loading.has(noteId)) void loadComments(noteId);
}

/**
 * A comment that the server sent, from a reply or the socket, sealed as it
 * came. It is opened, then added, or put in the place of the held copy. Ignored
 * for a note whose comments are not loaded, which asks for all of them when it
 * opens, and for a comment that does not open. Never rejects.
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

/** Drops what is kept for a note, when its panel goes away. */
export function forgetComments(noteId: string): void {
  watched.delete(noteId);
  loading.delete(noteId);
  setFailed(noteId, false);
  if (noteComments.value.has(noteId)) setFor(noteId, null);
}

/**
 * Reads the comments of a note, and keeps them until `forgetComments`. When
 * called again for a note that is already kept, it replaces the list. Thus, a
 * panel gets the updates. The code drops an answer that arrives after the panel
 * went away, or after a later load of the same note started.
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
    // Sealed under the key of the note. The code does not include a comment
    // that does not open.
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
    // Silently. The note is what was opened, and the panel tells that it could
    // not load. No toast comes over the editor.
    console.error(`Failed to load comments of ${noteId}:`, err);
    if (current()) {
      loading.delete(noteId);
      // A list that is already kept stays. A failed catch-up is not a reason to
      // lose it.
      setFailed(noteId, !noteComments.value.has(noteId));
    }
    return false;
  }
}

/** Reads again for each panel that is open, after a gap in the socket. */
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
    // The id is selected here, because the sealed text is bound to it.
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
    // The same words again are not an edit. If the code sealed them again, they
    // would look like one.
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
    // Already gone is what the request asked for.
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
