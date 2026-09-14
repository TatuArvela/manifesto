import type {
  DirectoryUser,
  InvitationsResponse,
  Note,
  NoteResponse,
  ShareInvitation,
  ShareRole,
  UserLookupResponse,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { t } from "../i18n/index.js";
import type { MessageKey } from "../i18n/messages/index.js";
import { storageConnection } from "../storage/index.js";
import { notes, upsertById } from "./actions.js";
import { editingNoteId, showError, showSuccess } from "./ui.js";

/**
 * Sharing notes with other accounts, in connected mode.
 *
 * Every action here follows the contract in `actions.ts`: it reports its own
 * failure and resolves, saying whether it worked in its return value. The
 * server's error text is English and written for a log, so failures are mapped
 * to catalogue messages by status, as `admin.ts` does.
 */

/** Notes other people have offered, newest first. */
export const invitations = signal<ShareInvitation[]>([]);

/**
 * The note whose people are being looked at, if any, and whether the dialog
 * opened on the question of leaving it. One dialog for the whole app: it is
 * opened from a note's menu, which closes as soon as a row is chosen.
 */
export const shareDialog = signal<{
  noteId: string;
  confirmLeave?: boolean;
} | null>(null);

class SharingRequestError extends Error {
  constructor(public status: number) {
    super(`Sharing request failed (${status})`);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T | null> {
  const { serverUrl, token, onUnauthorized } = storageConnection.value;
  if (!serverUrl || !token) throw new SharingRequestError(401);
  const res = await fetch(`${serverUrl}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new SharingRequestError(res.status);
  }
  if (res.status === 204) return null;
  return (await res.json()) as T;
}

/**
 * Say what went wrong. A `fetch` that never reached the server is a network
 * failure, and the fallback is the most honest thing to say about it.
 */
function report(
  context: string,
  err: unknown,
  fallback: MessageKey,
  byStatus: Partial<Record<number, MessageKey>> = {},
) {
  console.error(context, err);
  const status = err instanceof SharingRequestError ? err.status : 0;
  if (status === 401) return; // signed out; the login screen says enough
  showError(t(byStatus[status] ?? fallback));
}

const byId = (noteId: string) => (i: ShareInvitation) => i.noteId === noteId;

/** Add or refresh one invitation, as the socket reports it. */
export function receiveInvitation(invitation: ShareInvitation): void {
  const known = invitations.value.some(byId(invitation.noteId));
  invitations.value = [
    invitation,
    ...invitations.value.filter((i) => i.noteId !== invitation.noteId),
  ];
  if (!known) {
    showSuccess(
      t("sharing.invitation.received", {
        name: invitation.owner.displayName,
      }),
    );
  }
}

export function forgetInvitation(noteId: string): void {
  invitations.value = invitations.value.filter((i) => i.noteId !== noteId);
}

export async function loadInvitations(): Promise<boolean> {
  try {
    const body = await request<InvitationsResponse>("GET", "/invitations");
    invitations.value = body?.invitations ?? [];
    return true;
  } catch (err) {
    // Not worth a toast on start: the notes are what the user came for, and
    // the next reconnect or reload asks again.
    console.error("Failed to load invitations:", err);
    return false;
  }
}

export async function acceptInvitation(noteId: string): Promise<boolean> {
  try {
    const body = await request<NoteResponse>(
      "POST",
      `/invitations/${noteId}/accept`,
    );
    forgetInvitation(noteId);
    if (body) notes.value = upsertById(notes.value, body.note);
    return true;
  } catch (err) {
    // Gone: withdrawn, or the note was trashed or deleted in the meantime.
    // There is nothing left to accept, so the offer goes too.
    if (err instanceof SharingRequestError && err.status === 404) {
      forgetInvitation(noteId);
    }
    report(
      `Failed to accept invitation ${noteId}:`,
      err,
      "sharing.error.acceptFailed",
      {
        404: "sharing.error.invitationGone",
      },
    );
    return false;
  }
}

export async function declineInvitation(noteId: string): Promise<boolean> {
  try {
    await request<null>("POST", `/invitations/${noteId}/decline`);
    forgetInvitation(noteId);
    return true;
  } catch (err) {
    if (err instanceof SharingRequestError && err.status === 404) {
      forgetInvitation(noteId);
      return true;
    }
    report(
      `Failed to decline invitation ${noteId}:`,
      err,
      "sharing.error.declineFailed",
    );
    return false;
  }
}

/**
 * Accounts matching what the owner typed: any part of a name or address, or
 * only a whole one, depending on the server. `null` when the lookup failed,
 * which is not the same as nobody matching.
 */
export async function findUsers(
  query: string,
): Promise<DirectoryUser[] | null> {
  const q = query.trim();
  if (q.length === 0) return [];
  try {
    const body = await request<UserLookupResponse>(
      "GET",
      `/users?q=${encodeURIComponent(q)}`,
    );
    return body?.users ?? [];
  } catch (err) {
    report("Failed to look up users:", err, "sharing.error.lookupFailed");
    return null;
  }
}

function replaceNote(note: Note) {
  notes.value = upsertById(notes.value, note);
}

export async function shareNote(
  noteId: string,
  userId: string,
  role: ShareRole,
): Promise<boolean> {
  try {
    const body = await request<NoteResponse>(
      "POST",
      `/notes/${noteId}/shares`,
      {
        userId,
        role,
      },
    );
    if (body) replaceNote(body.note);
    return true;
  } catch (err) {
    report(
      `Failed to share note ${noteId}:`,
      err,
      "sharing.error.shareFailed",
      {
        403: "sharing.error.ownerOnly",
        404: "sharing.error.userGone",
        409: "sharing.error.alreadyShared",
      },
    );
    return false;
  }
}

export async function setShareRole(
  noteId: string,
  userId: string,
  role: ShareRole,
): Promise<boolean> {
  try {
    const body = await request<NoteResponse>(
      "PUT",
      `/notes/${noteId}/shares/${userId}`,
      { role },
    );
    if (body) replaceNote(body.note);
    return true;
  } catch (err) {
    report(
      `Failed to change a role on note ${noteId}:`,
      err,
      "sharing.error.roleFailed",
      {
        403: "sharing.error.ownerOnly",
      },
    );
    return false;
  }
}

/** The owner takes someone off a note, or withdraws an invitation. */
export async function removeShare(
  noteId: string,
  userId: string,
): Promise<boolean> {
  try {
    await request<null>("DELETE", `/notes/${noteId}/shares/${userId}`);
    // The server's `note:updated` says the same a moment later; saying it
    // here keeps the dialog from showing someone who is already gone.
    notes.value = notes.value.map((note) => {
      if (note.id !== noteId || !note.sharing) return note;
      const members = note.sharing.members.filter((m) => m.id !== userId);
      if (members.length > 0) {
        return { ...note, sharing: { ...note.sharing, members } };
      }
      const { sharing: _sharing, ...unshared } = note;
      return unshared;
    });
    return true;
  } catch (err) {
    report(
      `Failed to remove a person from note ${noteId}:`,
      err,
      "sharing.error.removeFailed",
      {
        403: "sharing.error.ownerOnly",
      },
    );
    return false;
  }
}

/**
 * Take a note someone shared out of the signed-in user's notes. It stays with
 * its owner and everyone else; getting it back takes a new invitation.
 */
export async function leaveNote(
  noteId: string,
  userId: string,
): Promise<boolean> {
  try {
    await request<null>("DELETE", `/notes/${noteId}/shares/${userId}`);
  } catch (err) {
    // Already gone is as good as left.
    if (!(err instanceof SharingRequestError && err.status === 404)) {
      report(
        `Failed to leave note ${noteId}:`,
        err,
        "sharing.error.leaveFailed",
      );
      return false;
    }
  }
  if (editingNoteId.value === noteId) editingNoteId.value = null;
  notes.value = notes.value.filter((n) => n.id !== noteId);
  return true;
}
