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
import { t } from "../i18n/index.js";
import type { MessageKey } from "../i18n/messages/index.js";
import { connectionOutage } from "../realtime/connectionOutage.js";
import { ApiError, apiJson } from "../storage/apiRequest.js";
import { type NoteSealing, sealer } from "../storage/sealing.js";
import {
  adoptOfferedKey,
  leaveFeedKey,
  offerKeyTo,
  replaceNoteKey,
  supplyKey,
  trustChangedKeys,
} from "../storage/shareKeys.js";
import { forgetNote, notes, receiveNote, reviseNote } from "./notesStore.js";
import { serverFeature } from "./serverFeatures.js";
import { editingNoteId, showError, showSuccess } from "./ui.js";

/**
 * Sharing notes with other accounts, in connected mode.
 *
 * Every action here follows the contract in `actions.ts`: it reports its own
 * failure and resolves, saying whether it worked in its return value. The
 * server's error text is English and written for a log, so failures are mapped
 * to catalogue messages by status, as `admin.ts` does.
 */

/**
 * An invitation as the app shows it: the note's title, text and font opened
 * with the key that came with it. `waiting` while no key has come, or the one
 * that came did not check against its signer: nothing of the note is shown
 * then, and it cannot be accepted yet.
 */
export interface Invitation
  extends Omit<
    ShareInvitation,
    "title" | "content" | "font" | "keyVersion" | "offered"
  > {
  title: string;
  content: string;
  /** The owner's colour is their own; an invitation has none. */
  color: NoteColor;
  font: NoteFont;
  waiting: boolean;
}

/** Notes other people have offered, newest first. */
export const invitations = signal<Invitation[]>([]);

/** The key each open invitation came with, as this account will keep it. */
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
  // A refreshed invitation is judged on what it carries now: the key an
  // earlier copy came with may be one the note has since moved away from.
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

/** A note the server answered with, opened; null when it does not open. */
async function openedNote(
  sealed: SealedNote | undefined,
): Promise<Note | null> {
  if (!sealed) return null;
  return (await sealer.peek()?.open(sealed)) ?? null;
}

/**
 * The note whose people are being looked at, if any. One dialog for the whole
 * app: it is opened from a note's menu, which closes as soon as a row is
 * chosen.
 */
export const shareDialog = signal<{ noteId: string } | null>(null);

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
  console.error("%s", context, err);
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 401) return; // signed out; the login screen says enough
  showError(t(byStatus[status] ?? fallback));
}

const byId = (noteId: string) => (i: Invitation) => i.noteId === noteId;

/**
 * The notes whose invitation the socket added or took away while a load was
 * opening its list. The load's answer is older than those, so it leaves them
 * as they are now.
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
    // Each may wait on a key lookup, so they open side by side.
    const list = await Promise.all((body?.invitations ?? []).map(opened));
    const settled = invitations.value.filter((i) =>
      changedDuringLoad.has(i.noteId),
    );
    invitations.value = [
      ...settled,
      ...list.filter((i) => !changedDuringLoad.has(i.noteId)),
    ];
    // One taken away meanwhile keeps no key this load may have opened for it.
    for (const noteId of changedDuringLoad) {
      if (!settled.some(byId(noteId))) heldKeys.delete(noteId);
    }
    return true;
  } catch (err) {
    // Not worth a toast on start: the notes are what the user came for, and
    // the next reconnect or reload asks again.
    console.error("Failed to load invitations:", err);
    return false;
  } finally {
    loading--;
    if (loading === 0) changedDuringLoad.clear();
  }
}

export async function acceptInvitation(noteId: string): Promise<boolean> {
  // Accepting keeps the note's key under this account's own notes key. An
  // invitation still waiting for one has nothing to keep.
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
    // There is nothing left to accept, so the offer goes too.
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
    // The note's key, wrapped to their public key and signed. Without one
    // (an account not set up yet) the invitation waits, and whoever holds
    // the note wraps it for them later.
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

/** The owner takes someone off a note, or withdraws an invitation. */
export async function removeShare(
  noteId: string,
  userId: string,
): Promise<boolean> {
  try {
    await apiJson<null>("DELETE", `/notes/${noteId}/shares/${userId}`);
    // The server's `note:updated` says the same a moment later; saying it
    // here keeps the dialog from showing someone who is already gone.
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
 * Take a note someone shared out of the signed-in user's notes. It stays with
 * its owner and everyone else; getting it back takes a new invitation.
 */
export async function leaveNote(
  noteId: string,
  userId: string,
): Promise<boolean> {
  try {
    await apiJson<null>("DELETE", `/notes/${noteId}/shares/${userId}`);
  } catch (err) {
    // Already gone is as good as left.
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
 * What each unlocked account has set about, by a name for the work, so an
 * effect that runs again does not start the same thing twice. Kept for the
 * `Sealer` it was done with and not for the page: a lock and unlock, or
 * another account signing in, starts with nothing in hand.
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
 * Starts `work` unless this unlocked account already has `what` under way.
 * It is in hand only while it runs. Work that did not succeed is tried again
 * by whatever runs the effect again (the connection coming back, the next
 * listing that changes it), and work that did is no longer asked for, until
 * the note is due it once more: a second person removed in one session
 * needs a second new key. `work` never rejects.
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
 * Supplying one person a note's key, as `inHand` names it. Kept once tried,
 * so someone who cannot be supplied (an account with no keys yet) is not
 * asked about on every change of a note; `trustKeys` forgets. The name
 * carries the key the note was last moved to here: a key replaced again
 * leaves everyone waiting again, whoever was supplied the one before.
 */
const supplyOf = (sealing: NoteSealing, noteId: string, userId: string) =>
  `supply ${noteId} ${sealing.replaced.peek().get(noteId) ?? 0} ${userId}`;

/**
 * Hands the note's key to whoever on it is still waiting for one: a member
 * of a team the note was shared with, or someone invited before they had
 * keys. Whichever holder of the note is online first does it, the owner or
 * not. Never rejects.
 */
async function supplyWaiting(note: Note): Promise<void> {
  const sealing = sealer.peek();
  if (!sealing) return;
  const supplied = handOf(sealing);
  // A viewer holds the key as much as anyone, so anyone on the note may.
  for (const member of note.sharing?.members ?? []) {
    if (!member.waitingForKey) continue;
    const tried = supplyOf(sealing, note.id, member.id);
    if (supplied.has(tried)) continue;
    supplied.add(tried);
    // A request that did not get through is tried again the next time the
    // effect below runs: when the connection is back, or the notes change.
    if ((await supplyKey(note.id, member.id)) === "failed") {
      supplied.delete(tried);
    }
  }
}

/**
 * The person looked at an account's changed key and takes it: remembered in
 * place of the old one, and whatever waited on it is tried again. Never
 * rejects.
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
  // An invitation whose key they signed can be opened now.
  void loadInvitations();
  return true;
}

export { changedKeys, keyStatusOf } from "../storage/shareKeys.js";

// A note is due a new key once someone who held the old one is gone: the
// owner's app makes it, whichever of their devices is online first. One
// that fails stays due, under the key the person who left still holds, so
// it is not given up on: tried again when the connection is back after an
// outage, when the set of due notes changes, and when the account is next
// unlocked.
effect(() => {
  const sealing = sealer.value;
  if (!sealing?.handsKeysOn) return;
  if (connectionOutage.value) return;
  for (const id of sealing.due.value) {
    setAbout(sealing, `rekey ${id}`, () => replaceNoteKey(id));
  }
});

// A note with a reminder and no copy of its key for a calendar feed: a
// script set the reminder, or the note's key was replaced. Whichever device
// of the account sees it leaves the copy, and tries again as above.
effect(() => {
  const sealing = sealer.value;
  if (!sealing?.handsKeysOn) return;
  if (connectionOutage.value) return;
  for (const id of sealing.feedDue.value) {
    setAbout(sealing, `feed ${id}`, () => leaveFeedKey(id));
  }
});

// Follows the notes: a share to a team reaches its members with no key, and
// this is the "first client of anyone holding the note" that wraps it.
effect(() => {
  const sealing = sealer.value;
  if (!sealing?.handsKeysOn) return;
  if (connectionOutage.value) return;
  // Read so the effect runs again when a note's key is replaced.
  void sealing.replaced.value;
  for (const note of notes.value) {
    if (roleOf(note) === "view" && !note.sharing) continue;
    if (note.sharing?.members.some((m) => m.waitingForKey)) {
      void supplyWaiting(note);
    }
  }
});
