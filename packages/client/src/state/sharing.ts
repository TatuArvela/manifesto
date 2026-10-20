import {
  type DirectoryUser,
  type HeldKeyRequest,
  type InvitationsResponse,
  type Note,
  NoteColor,
  NoteFont,
  type NoteResponse,
  roleOf,
  type SealedNote,
  type ShareInvitation,
  type ShareRole,
  type UserLookupResponse,
} from "@manifesto/shared";
import { effect, signal } from "@preact/signals";
import { t } from "#/i18n/index.ts";
import type { MessageKey } from "#/i18n/messages/index.ts";
import { connectionOutage } from "#/realtime/connectionOutage.ts";
import { ApiError, apiJson } from "#/storage/apiRequest.ts";
import { type NoteSealing, sealer } from "#/storage/sealing.ts";
import {
  adoptOfferedKey,
  leaveFeedKey,
  offerKeyTo,
  replaceNoteKey,
  supplyKey,
  trustChangedKeys,
} from "#/storage/shareKeys.ts";
import { forgetNote, notes, receiveNote, reviseNote } from "./notesStore.ts";
import { serverFeature } from "./serverFeatures.ts";
import { editingNoteId, showError, showSuccess } from "./ui.ts";

/**
 * Sharing of notes with other accounts, in connected mode.
 *
 * Each action here follows the contract in `actions.ts`. It reports its own
 * failure and resolves, and its return value tells if it worked. The error text
 * of the server is English and written for a log. Thus, the code maps failures
 * to catalogue messages by status, as `admin.ts` does.
 */

/**
 * An invitation as the app shows it: the title, text and font of the note,
 * opened with the key that came with it. `waiting` while no key came, or while
 * the key that came did not pass the check against its signer. Then nothing of
 * the note shows, and the person cannot accept it yet.
 */
export interface Invitation
  extends Omit<
    ShareInvitation,
    "title" | "content" | "font" | "keyVersion" | "offered"
  > {
  title: string;
  content: string;
  /** The color of the owner belongs to the owner. An invitation has none. */
  color: NoteColor;
  font: NoteFont;
  waiting: boolean;
}

/** Notes that other persons offered, newest first. */
export const invitations = signal<Invitation[]>([]);

/**
 * The key that came with each open invitation, as this account will keep it.
 */
const heldKeys = new Map<string, HeldKeyRequest>();

/** Opens an invitation as it arrived from the server. Never rejects. */
async function opened(raw: ShareInvitation): Promise<Invitation> {
  const {
    title: _t,
    content: _c,
    font: _f,
    keyVersion,
    offered,
    ...rest
  } = raw;
  const waiting: Invitation = {
    ...rest,
    title: "",
    content: "",
    color: NoteColor.Default,
    font: NoteFont.Default,
    waiting: true,
  };
  // The code decides about a refreshed invitation from what it carries now. The
  // key that an earlier copy came with can be a key that the note moved away
  // from since then.
  heldKeys.delete(raw.noteId);
  const sealing = sealer.peek();
  if (!sealing || !offered) return waiting;
  try {
    const held = await adoptOfferedKey(sealing, raw.noteId, offered, raw);
    if (!held) return waiting;
    const preview = await sealing.openPreview(raw.noteId, keyVersion, raw);
    if (!preview) return waiting;
    heldKeys.set(raw.noteId, held);
    return { ...waiting, ...preview, waiting: false };
  } catch (err) {
    console.warn("Failed to open an invitation:", err);
    return waiting;
  }
}

/**
 * A note with which the server answered, opened. Null when it does not open.
 */
async function openedNote(
  sealed: SealedNote | undefined,
): Promise<Note | null> {
  if (!sealed) return null;
  return (await sealer.peek()?.open(sealed)) ?? null;
}

/**
 * The note whose people the user looks at, if any. One dialog for the full app.
 * A menu of a note opens it, and the menu closes when the user selects a row.
 */
export const shareDialog = signal<{ noteId: string } | null>(null);

/**
 * Tell what went wrong. A `fetch` that never reached the server is a network
 * failure, and the fallback is the most correct thing to say about it.
 */
function report(
  context: string,
  err: unknown,
  fallback: MessageKey,
  byStatus: Partial<Record<number, MessageKey>> = {},
) {
  console.error("%s", context, err);
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 401) return; // signed out; the login screen tells sufficient
  showError(t(byStatus[status] ?? fallback));
}

const byId = (noteId: string) => (i: Invitation) => i.noteId === noteId;

/**
 * The notes whose invitation the socket added or removed while a load opened
 * its list. The answer of the load is older than those. Thus, it keeps them as
 * they are now.
 */
const changedDuringLoad = new Set<string>();
let loading = 0;

function touched(noteId: string): void {
  if (loading > 0) changedDuringLoad.add(noteId);
}

/** Add or refresh one invitation, as the socket reports it. Never rejects. */
export async function receiveInvitation(raw: ShareInvitation): Promise<void> {
  const invitation = await opened(raw);
  touched(invitation.noteId);
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
  touched(noteId);
  heldKeys.delete(noteId);
  invitations.value = invitations.value.filter((i) => i.noteId !== noteId);
}

export async function loadInvitations(): Promise<boolean> {
  // A server with sharing off has no invitations to ask about.
  if (!serverFeature("sharing")) {
    invitations.value = [];
    return true;
  }
  loading++;
  try {
    const body = await apiJson<InvitationsResponse>("GET", "/invitations");
    // Each can wait for a key lookup. Thus, they open in parallel.
    const list = await Promise.all((body?.invitations ?? []).map(opened));
    const settled = invitations.value.filter((i) =>
      changedDuringLoad.has(i.noteId),
    );
    invitations.value = [
      ...settled,
      ...list.filter((i) => !changedDuringLoad.has(i.noteId)),
    ];
    // An invitation removed in the meantime keeps no key that this load
    // possibly opened for it.
    for (const noteId of changedDuringLoad) {
      if (!settled.some(byId(noteId))) heldKeys.delete(noteId);
    }
    return true;
  } catch (err) {
    // Not worth a toast on start. The user came for the notes, and the next
    // reconnect or reload asks again.
    console.error("Failed to load invitations:", err);
    return false;
  } finally {
    loading--;
    if (loading === 0) changedDuringLoad.clear();
  }
}

export async function acceptInvitation(noteId: string): Promise<boolean> {
  // An accept keeps the key of the note under the own notes key of this
  // account. An invitation that still waits for a key has nothing to keep.
  const held = heldKeys.get(noteId);
  if (!held) {
    showError(t("sharing.error.waitingForKey"));
    return false;
  }
  try {
    const body = await apiJson<NoteResponse<SealedNote>>(
      "POST",
      `/invitations/${noteId}/accept`,
      held,
    );
    forgetInvitation(noteId);
    const note = await openedNote(body?.note);
    if (note) receiveNote(note);
    return true;
  } catch (err) {
    // Gone: withdrawn, or the note was trashed or deleted in the meantime.
    // There is nothing left to accept. Thus, the offer also goes.
    if (err instanceof ApiError && err.status === 404) {
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
    await apiJson<null>("POST", `/invitations/${noteId}/decline`);
    forgetInvitation(noteId);
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
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
 * Accounts that match what the owner typed: any part of a name or address, or
 * only a full one, as the server decides. `null` when the lookup failed, which
 * is not the same as no match.
 */
export async function findUsers(
  query: string,
): Promise<DirectoryUser[] | null> {
  const q = query.trim();
  if (q.length === 0) return [];
  try {
    const body = await apiJson<UserLookupResponse>(
      "GET",
      `/users?q=${encodeURIComponent(q)}`,
    );
    return body?.users ?? [];
  } catch (err) {
    report("Failed to look up users:", err, "sharing.error.lookupFailed");
    return null;
  }
}

export async function shareNote(
  noteId: string,
  userId: string,
  role: ShareRole,
): Promise<boolean> {
  try {
    // The key of the note, wrapped to their public key and signed. Without one
    // (an account that is not set up yet), the invitation waits, and a holder
    // of the note wraps it for them later.
    const key = await offerKeyTo(noteId, userId);
    const body = await apiJson<NoteResponse<SealedNote>>(
      "POST",
      `/notes/${noteId}/shares`,
      {
        userId,
        role,
        ...(key && { key }),
      },
    );
    const note = await openedNote(body?.note);
    if (note) receiveNote(note);
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
    const body = await apiJson<NoteResponse<SealedNote>>(
      "PUT",
      `/notes/${noteId}/shares/${userId}`,
      { role },
    );
    const note = await openedNote(body?.note);
    if (note) receiveNote(note);
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

/** The owner removes a person from a note, or withdraws an invitation. */
export async function removeShare(
  noteId: string,
  userId: string,
): Promise<boolean> {
  try {
    await apiJson<null>("DELETE", `/notes/${noteId}/shares/${userId}`);
    // The `note:updated` of the server tells the same a moment later. When this
    // code tells it here, the dialog does not show a person who is already
    // gone.
    reviseNote(noteId, (note) => {
      if (!note.sharing) return note;
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
 * Remove a note that a different person shared from the notes of the signed-in
 * user. It stays with its owner and all other persons. To get it back, the user
 * needs a new invitation.
 */
export async function leaveNote(
  noteId: string,
  userId: string,
): Promise<boolean> {
  try {
    await apiJson<null>("DELETE", `/notes/${noteId}/shares/${userId}`);
  } catch (err) {
    // Already gone is the same as left.
    if (!(err instanceof ApiError && err.status === 404)) {
      report(
        `Failed to leave note ${noteId}:`,
        err,
        "sharing.error.leaveFailed",
      );
      return false;
    }
  }
  if (editingNoteId.value === noteId) editingNoteId.value = null;
  forgetNote(noteId);
  return true;
}

/**
 * What each unlocked account started, by a name for the work. Thus, an effect
 * that runs again does not start the same work two times. Kept for the `Sealer`
 * with which it was done, not for the page. A lock and unlock, or a sign-in of
 * a different account, starts with nothing in progress.
 */
const inHand = new WeakMap<NoteSealing, Set<string>>();

function handOf(sealing: NoteSealing): Set<string> {
  let hand = inHand.get(sealing);
  if (!hand) {
    hand = new Set();
    inHand.set(sealing, hand);
  }
  return hand;
}

/**
 * Starts `work`, unless this unlocked account already has `what` in progress.
 * It is in progress only while it runs. The next run of the effect (the
 * connection comes back, the next listing that changes it) tries again the work
 * that did not succeed. The code does not ask again for work that did succeed,
 * until the note needs it again. A second person removed in one session needs a
 * second new key. `work` never rejects.
 */
function setAbout(
  sealing: NoteSealing,
  what: string,
  work: () => Promise<boolean>,
): void {
  const hand = handOf(sealing);
  if (hand.has(what)) return;
  hand.add(what);
  void work().then(() => {
    hand.delete(what);
  });
}

/**
 * The supply of the key of a note to one person, as `inHand` names it. Kept
 * after one try. Thus, the code does not ask about a person whom it cannot
 * supply (an account with no keys yet) on each change of a note. `trustKeys`
 * forgets. The name carries the key to which the note last moved here. A key
 * replaced again makes all persons wait again, whoever got the previous key.
 */
const supplyOf = (sealing: NoteSealing, noteId: string, userId: string) =>
  `supply ${noteId} ${sealing.replaced.peek().get(noteId) ?? 0} ${userId}`;

/**
 * Gives the key of the note to each person on it who still waits for one: a
 * member of a team with which the note was shared, or a person invited before
 * they had keys. The first holder of the note that is online does it, the owner
 * or not. Never rejects.
 */
async function supplyWaiting(note: Note): Promise<void> {
  const sealing = sealer.peek();
  if (!sealing) return;
  const supplied = handOf(sealing);
  // A viewer has the key as much as all other persons. Thus, all persons on the
  // note can do it.
  for (const member of note.sharing?.members ?? []) {
    if (!member.waitingForKey) continue;
    const tried = supplyOf(sealing, note.id, member.id);
    if (supplied.has(tried)) continue;
    supplied.add(tried);
    // The code tries again a request that did not get through the next time
    // that the effect below runs: when the connection is back, or when the
    // notes change.
    if ((await supplyKey(note.id, member.id)) === "failed") {
      supplied.delete(tried);
    }
  }
}

/**
 * The person looked at the changed key of an account and accepts it. It is
 * remembered in place of the old key, and the code tries again all that waited
 * on it. Never rejects.
 */
export async function trustKeys(userId: string): Promise<boolean> {
  if (!(await trustChangedKeys(userId))) {
    showError(t("sharing.keys.trustFailed"));
    return false;
  }
  const sealing = sealer.peek();
  if (sealing) {
    const supplied = handOf(sealing);
    for (const tried of supplied) {
      if (tried.startsWith("supply ") && tried.endsWith(` ${userId}`)) {
        supplied.delete(tried);
      }
    }
  }
  for (const note of notes.peek()) {
    if (note.sharing?.members.some((m) => m.waitingForKey)) {
      void supplyWaiting(note);
    }
  }
  // An invitation whose key they signed can open now.
  void loadInvitations();
  return true;
}

export { changedKeys, keyStatusOf } from "#/storage/shareKeys.ts";

// A note needs a new key after a person who had the old key is gone. The app of
// the owner makes it, on the first of their devices that is online. A note that
// fails stays due, under the key that the departed person still has. Thus, the
// code does not stop. It tries again when the connection is back after an
// outage, when the set of due notes changes, and at the next unlock of the
// account.
effect(() => {
  const sealing = sealer.value;
  if (!sealing?.handsKeysOn) return;
  if (connectionOutage.value) return;
  for (const id of sealing.due.value) {
    setAbout(sealing, `rekey ${id}`, () => replaceNoteKey(id));
  }
});

// A note with a reminder and no copy of its key for a calendar feed: a script
// set the reminder, or the key of the note was replaced. The device of the
// account that sees it leaves the copy, and tries again as above.
effect(() => {
  const sealing = sealer.value;
  if (!sealing?.handsKeysOn) return;
  if (connectionOutage.value) return;
  for (const id of sealing.feedDue.value) {
    setAbout(sealing, `feed ${id}`, () => leaveFeedKey(id));
  }
});

// Follows the notes. A share to a team reaches its members with no key, and
// this is the "first client of a person who has the note" that wraps it.
effect(() => {
  const sealing = sealer.value;
  if (!sealing?.handsKeysOn) return;
  if (connectionOutage.value) return;
  // Read, so that the effect runs again when the key of a note is replaced.
  void sealing.replaced.value;
  for (const note of notes.value) {
    if (roleOf(note) === "view" && !note.sharing) continue;
    if (note.sharing?.members.some((m) => m.waitingForKey)) {
      void supplyWaiting(note);
    }
  }
});
