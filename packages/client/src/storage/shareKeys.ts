import {
  type AccountKeysResponse,
  type AccountPublicKeysResponse,
  type HeldKeyRequest,
  keyFingerprint,
  type NoteResponse,
  type OfferedKey,
  type PublicLinksResponse,
  type SealedNote,
  type SeenKeysResponse,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { ApiError, apiFetch, apiJson } from "./apiRequest.js";
import {
  type NoteSealing,
  type SeenKeys,
  sealer,
  setOfferHandler,
} from "./sealing.js";

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

/**
 * What each unlocked account remembers of other people's keys, read from the
 * server once. The server hands out public keys, so it could hand out one of
 * its own: the first key seen for an account is remembered, sealed under this
 * account's key, and a different one later is used for nothing until the
 * person agrees to it.
 */
const remembered = new WeakMap<
  NoteSealing,
  Promise<Map<string, SeenKeys> | null>
>();

/**
 * The accounts whose keys are no longer the ones remembered, with the keys
 * the server now gives for them. Nothing is wrapped to such a key and no
 * signature is checked against it.
 */
export const changedKeys = signal<
  ReadonlyMap<string, AccountPublicKeysResponse>
>(new Map());

function markChanged(
  userId: string,
  given: AccountPublicKeysResponse | null,
): void {
  const held = changedKeys.peek();
  if (!given && !held.has(userId)) return;
  const next = new Map(held);
  if (given) next.set(userId, given);
  else next.delete(userId);
  changedKeys.value = next;
}

function rememberedBy(
  sealing: NoteSealing,
): Promise<Map<string, SeenKeys> | null> {
  let pending = remembered.get(sealing);
  if (!pending) {
    pending = apiJson<SeenKeysResponse>("GET", "/auth/keys/seen")
      .then((body) => sealing.openSeenKeys(body?.seen ?? {}))
      .catch(() => {
        // Not read: nobody's key is taken on trust meanwhile, and the next
        // use asks again.
        remembered.delete(sealing);
        return null;
      });
    remembered.set(sealing, pending);
  }
  return pending;
}

/** Remembers `given` as the account's keys, here and on the server. */
async function remember(
  sealing: NoteSealing,
  seen: Map<string, SeenKeys>,
  given: AccountPublicKeysResponse,
): Promise<boolean> {
  const keys: SeenKeys = { version: given.version, ...given.publicKeys };
  seen.set(given.userId, keys);
  try {
    const res = await apiFetch(
      "PUT",
      `/auth/keys/seen/${encodeURIComponent(given.userId)}`,
      { sealed: await sealing.sealSeenKeys(given.userId, keys) },
    );
    return res?.ok ?? false;
  } catch {
    // Remembered for this session all the same.
    return false;
  }
}

const sameKeys = (seen: SeenKeys, given: AccountPublicKeysResponse) =>
  seen.exchange === given.publicKeys.exchange &&
  seen.signing === given.publicKeys.signing;

/**
 * An account's public keys, if they are the ones this account remembers for
 * it, or the first it has seen. Null when it has none, when they could not be
 * read, and when they have changed: then `changedKeys` names the account.
 */
export async function trustedKeysOf(
  userId: string,
): Promise<AccountPublicKeysResponse | null> {
  const given = await publicKeysOf(userId);
  if (!given) return null;
  const sealing = sealer.peek();
  // Sealing that seals nothing has no keys to tell apart.
  if (!sealing?.handsKeysOn) return given;
  const seen = await rememberedBy(sealing);
  if (!seen) return null;
  const known = seen.get(userId);
  if (!known) {
    await remember(sealing, seen, given);
    return given;
  }
  if (sameKeys(known, given)) {
    markChanged(userId, null);
    return given;
  }
  markChanged(userId, given);
  return null;
}

/**
 * Takes the keys the server now gives for an account in place of the ones
 * remembered: the person has compared the fingerprint, or decided to go on
 * without. Resolves whether it is remembered on the server; never rejects.
 */
export async function trustChangedKeys(userId: string): Promise<boolean> {
  const sealing = sealer.peek();
  const given = changedKeys.peek().get(userId);
  if (!sealing || !given) return false;
  const seen = await rememberedBy(sealing);
  if (!seen) return false;
  const kept = await remember(sealing, seen, given);
  if (kept) markChanged(userId, null);
  else seen.delete(userId);
  return kept;
}

/**
 * The fingerprint of the keys the server gives for an account, for two
 * people to compare, and whether they are other than the ones remembered.
 * Null for an account with no keys yet. Never rejects.
 */
export async function keyStatusOf(
  userId: string,
): Promise<{ fingerprint: string; changed: boolean } | null> {
  try {
    const given = await publicKeysOf(userId);
    if (!given) return null;
    const trusted = await trustedKeysOf(userId);
    return {
      fingerprint: await keyFingerprint(given.publicKeys),
      changed: trusted === null && changedKeys.peek().has(userId),
    };
  } catch {
    return null;
  }
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
  // Only to a key this account has seen for them before, or sees first now.
  const recipient = await trustedKeysOf(recipientId);
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
  // Checked against the key remembered for the signer: one the server
  // swapped since checks nothing.
  const signer = await trustedKeysOf(offered.signer);
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

/** How often a replacement is sealed again when the note is written under
 * it, before it is left for the next try. */
const REKEY_ATTEMPTS = 3;

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
    for (let attempt = 0; attempt < REKEY_ATTEMPTS; attempt++) {
      const sealed = await sealedNote(noteId)();
      // Not due any more: another device of this account got there first.
      if (!sealed?.rekeyDue) return false;
      const listed = await apiJson<PublicLinksResponse>(
        "GET",
        `/notes/${noteId}/links`,
      );
      const made = await sealing.rekey(sealed, listed?.links ?? []);
      if (!made) return false;
      // The fields were sealed again from the note as just read. The server
      // takes them only if nothing has written it since, or an edit made
      // meanwhile would be undone.
      const res = await apiFetch("PUT", `/notes/${noteId}/key`, made.body, {
        "If-Match": sealed.updatedAt,
      });
      if (res?.ok) {
        made.commit();
        return true;
      }
      // Written since (412): read again and seal what is there now.
      if (res?.status !== 412) break;
    }
  } catch (err) {
    console.warn("Failed to replace a note's key:", err);
  }
  // Lost to another device, written under too often, or offline: the note
  // stays due, and whoever asked tries again.
  return false;
}

/**
 * Leaves a calendar feed the key of a note that has a reminder and no copy
 * for it yet. Resolves whether the server took it; never rejects.
 */
export async function leaveFeedKey(noteId: string): Promise<boolean> {
  const sealing = sealer.peek();
  if (!sealing?.handsKeysOn) return false;
  try {
    const res = await apiFetch("PUT", `/notes/${noteId}`, {
      reminderKey: await sealing.feedKey(noteId, sealedNote(noteId)),
    });
    return res?.ok ?? false;
  } catch (err) {
    console.warn("Failed to leave a calendar feed a note's key:", err);
    return false;
  }
}
