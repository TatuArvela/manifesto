import type {
  AccountKeysResponse,
  AccountPublicKeysResponse,
  HeldKeyRequest,
  NoteResponse,
  OfferedKey,
  PublicLinksResponse,
  SealedNote,
} from "@manifesto/shared";
import { ApiError, apiFetch, apiJson } from "./apiRequest.js";
import { type NoteSealing, sealer, setOfferHandler } from "./sealing.js";

/**
 * Handing a shared note's key from account to account
 * (`docs/specification/features/encryption.md`, "Sharing"): the requests
 * around what `Sealer` wraps, checks and opens. Apart from `sealing.ts`
 * because these reach the server through `apiRequest.ts`, which the sealing
 * itself must not import.
 */

/** Each account's public keys, as the server gave them this session. */
const publicKeys = new Map<string, Promise<AccountPublicKeysResponse | null>>();

/** An account's public keys, or null when it has none yet or they could not
 * be read. Asked once a session for each account. */
export function publicKeysOf(
  userId: string,
): Promise<AccountPublicKeysResponse | null> {
  let pending = publicKeys.get(userId);
  if (!pending) {
    pending = apiJson<AccountPublicKeysResponse>(
      "GET",
      `/users/${encodeURIComponent(userId)}/keys`,
    ).catch((err) => {
      // An account that is not set up yet may be tomorrow; one that could
      // not be asked about, in a moment.
      if (!(err instanceof ApiError && err.status === 404)) {
        publicKeys.delete(userId);
      }
      return null;
    });
    publicKeys.set(userId, pending);
  }
  return pending;
}

/** Forget what was learned of an account's keys, so the next use asks. */
export function forgetPublicKeys(userId: string): void {
  publicKeys.delete(userId);
}

/** This account's own keys as the server holds them, private halves wrapped. */
async function ownKeys() {
  try {
    return (
      (await apiJson<AccountKeysResponse>("GET", "/auth/keys"))?.keys ?? null
    );
  } catch {
    return null;
  }
}

export const sealedNote = (noteId: string) => async () => {
  try {
    const body = await apiJson<NoteResponse<SealedNote>>(
      "GET",
      `/notes/${noteId}`,
    );
    return body?.note ?? null;
  } catch {
    return null;
  }
};

/**
 * The key of a note this account holds, wrapped to `recipientId`'s public
 * key and signed. Null when the recipient has no keys yet, or this device
 * cannot wrap: the invitation then waits for a key.
 */
export async function offerKeyTo(
  noteId: string,
  recipientId: string,
): Promise<OfferedKey | null> {
  const sealing = sealer.peek();
  if (!sealing?.handsKeysOn) return null;
  const recipient = await publicKeysOf(recipientId);
  if (!recipient) return null;
  try {
    return await sealing.offerKey(
      noteId,
      { userId: recipientId, exchange: recipient.publicKeys.exchange },
      sealedNote(noteId),
      ownKeys,
    );
  } catch (err) {
    console.warn("Failed to wrap a note's key:", err);
    return null;
  }
}

/**
 * Takes a key offered to this account: checked against the signer's key,
 * opened, and wrapped under this account's own notes key. Null when it does
 * not check or open, and then nothing of the note is used.
 */
export async function adoptOfferedKey(
  sealing: NoteSealing,
  noteId: string,
  offered: OfferedKey,
): Promise<HeldKeyRequest | null> {
  // Sealing that seals nothing has no signature to check either.
  if (!sealing.handsKeysOn) {
    return sealing.adoptOffered(noteId, offered, "", ownKeys);
  }
  const signer = await publicKeysOf(offered.signer);
  if (!signer) return null;
  try {
    return await sealing.adoptOffered(
      noteId,
      offered,
      signer.publicKeys.signing,
      ownKeys,
    );
  } catch (err) {
    console.warn("Failed to open an offered key:", err);
    return null;
  }
}

/**
 * A note whose key was replaced reaches a recipient with the new key offered
 * and no copy of their own. Their client takes the offer and keeps it, so
 * the next device of theirs opens the note without doing this again.
 */
setOfferHandler(async (sealing, sealed) => {
  if (!sealed.offered) return;
  const held = await adoptOfferedKey(sealing, sealed.id, sealed.offered);
  if (held) void apiFetch("PUT", `/notes/${sealed.id}/held-key`, held);
});

/** Hands `recipientId`, who is on the note and waiting, its key. Resolves
 * whether the server took it; never rejects. */
export async function supplyKey(
  noteId: string,
  recipientId: string,
): Promise<boolean> {
  const offered = await offerKeyTo(noteId, recipientId);
  if (!offered) return false;
  const res = await apiFetch(
    "PUT",
    `/notes/${noteId}/shares/${encodeURIComponent(recipientId)}/key`,
    offered,
  );
  return res?.ok ?? false;
}

/**
 * Gives a note this account owns a new key, because someone who held the old
 * one no longer holds the note: everything everyone on it shares is sealed
 * again, and each live public link is handed the new key. The people still
 * on the note are then waiting for it, and are supplied like anyone else
 * who waits. Resolves whether the note is under a new key; never rejects.
 */
export async function replaceNoteKey(noteId: string): Promise<boolean> {
  const sealing = sealer.peek();
  if (!sealing?.handsKeysOn) return false;
  try {
    const sealed = await sealedNote(noteId)();
    // Not due any more: another device of this account got there first.
    if (!sealed?.rekeyDue) return false;
    const listed = await apiJson<PublicLinksResponse>(
      "GET",
      `/notes/${noteId}/links`,
    );
    const made = await sealing.rekey(sealed, listed?.links ?? []);
    if (!made) return false;
    const answer = await apiJson<NoteResponse<SealedNote>>(
      "PUT",
      `/notes/${noteId}/key`,
      made.body,
    );
    if (!answer) return false;
    made.commit();
    return true;
  } catch (err) {
    // Lost to another device, or offline: the note stays due, and the next
    // time it is listed it is tried again.
    console.warn("Failed to replace a note's key:", err);
    return false;
  }
}
