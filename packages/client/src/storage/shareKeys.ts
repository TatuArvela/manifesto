import {
  type AccountKeysResponse,
  type AccountPublicKeysResponse,
  type HeldKeyRequest,
  keyFingerprint,
  type NoteResponse,
  type OfferedKey,
  type PublicLink,
  type PublicLinksResponse,
  type SealedNote,
  type SeenKeysResponse,
  type SharedSealed,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import type { SeenKeys } from "./accountSealing.ts";
import { ApiError, apiFetch, apiJson } from "./apiRequest.ts";
import { type NoteSealing, sealer, setOfferHandler } from "./sealing.ts";

/**
 * The supply of the key of a shared note from account to account
 * (`docs/specification/features/encryption.md`, "Sharing"): the requests around
 * what `Sealer` wraps, checks and opens. Separate from `sealing.ts`, because
 * these reach the server through `apiRequest.ts`, which the sealing itself must
 * not import.
 */

/**
 * The result of a request for the public keys of an account: its keys, `none`
 * for an account that is not set up yet, or `failed` when the request did not
 * get through.
 */
type KeysLookup = AccountPublicKeysResponse | "none" | "failed";

/**
 * The public keys of each account, as the server gave them to the sealing in
 * `cachedFor`. Only keys are kept. An account with none yet can set them up at
 * any moment, and the code asks again after a request that failed. A different
 * account that unlocks (or the same account unlocked again) starts with nothing
 * kept.
 */
const publicKeys = new Map<string, Promise<KeysLookup>>();
let cachedFor: NoteSealing | null = null;

function lookUpKeys(userId: string): Promise<KeysLookup> {
  const sealing = sealer.peek();
  if (sealing !== cachedFor) {
    publicKeys.clear();
    cachedFor = sealing;
  }
  let pending = publicKeys.get(userId);
  if (!pending) {
    pending = apiJson<AccountPublicKeysResponse>(
      "GET",
      `/users/${encodeURIComponent(userId)}/keys`,
    ).then(
      (keys): KeysLookup => keys ?? "failed",
      (err): KeysLookup =>
        err instanceof ApiError && err.status === 404 ? "none" : "failed",
    );
    const asked = pending;
    publicKeys.set(userId, asked);
    void asked.then((found) => {
      if (typeof found === "string" && publicKeys.get(userId) === asked) {
        publicKeys.delete(userId);
      }
    });
  }
  return pending;
}

/**
 * The public keys of an account, or null when it has none yet or the code could
 * not read them.
 */
export async function publicKeysOf(
  userId: string,
): Promise<AccountPublicKeysResponse | null> {
  const found = await lookUpKeys(userId);
  return typeof found === "string" ? null : found;
}

/**
 * Forget what the code learned of the keys of an account. Thus, the next use
 * asks.
 */
export function forgetPublicKeys(userId: string): void {
  publicKeys.delete(userId);
}

/**
 * What each unlocked account remembers of the keys of other persons, read from
 * the server one time. The server gives out public keys. Thus, it could give
 * out one of its own. The first key seen for an account is remembered, sealed
 * under the key of this account. A different key later is used for nothing
 * until the person agrees to it.
 */
const remembered = new WeakMap<
  NoteSealing,
  Promise<Map<string, SeenKeys> | null>
>();

/**
 * The accounts whose keys are not the remembered keys now, with the keys that
 * the server now gives for them. Nothing is wrapped to such a key, and no
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
        // Not read. In the meantime, the code trusts the key of nobody, and the
        // next use asks again.
        remembered.delete(sealing);
        return null;
      });
    remembered.set(sealing, pending);
  }
  return pending;
}

/**
 * Remembers `given` as the keys of the account, on the server and then here. A
 * key that the server did not keep is not remembered. In the next session, it
 * would look like a first sight, and so would each key that the server gave
 * then.
 */
async function remember(
  sealing: NoteSealing,
  seen: Map<string, SeenKeys>,
  given: AccountPublicKeysResponse,
): Promise<boolean> {
  const keys: SeenKeys = { version: given.version, ...given.publicKeys };
  try {
    const res = await apiFetch(
      "PUT",
      `/auth/keys/seen/${encodeURIComponent(given.userId)}`,
      { sealed: await sealing.sealSeenKeys(given.userId, keys) },
    );
    if (!res?.ok) return false;
  } catch {
    return false;
  }
  seen.set(given.userId, keys);
  return true;
}

const sameKeys = (seen: SeenKeys, given: AccountPublicKeysResponse) =>
  seen.exchange === given.publicKeys.exchange &&
  seen.signing === given.publicKeys.signing;

/**
 * The public keys of an account, if they are the keys that this account
 * remembers for it, or the first that it saw. Null when it has none, when they
 * could not be read, and when they changed. Then `changedKeys` names the
 * account.
 */
export async function trustedKeysOf(
  userId: string,
): Promise<AccountPublicKeysResponse | null> {
  const given = await publicKeysOf(userId);
  if (!given) return null;
  const sealing = sealer.peek();
  // A sealing that seals nothing has no keys to tell apart.
  if (!sealing?.handsKeysOn) return given;
  const seen = await rememberedBy(sealing);
  if (!seen) return null;
  const known = seen.get(userId);
  if (!known) {
    if (await remember(sealing, seen, given)) return given;
    // Not kept. Thus, not taken. The list is read again next time, which also
    // marks this as worth another try (`wrapKeyFor`).
    remembered.delete(sealing);
    return null;
  }
  if (sameKeys(known, given)) {
    markChanged(userId, null);
    return given;
  }
  markChanged(userId, given);
  return null;
}

/**
 * Takes the keys that the server now gives for an account in place of the
 * remembered keys. The person compared the fingerprint, or decided to continue
 * without that. Resolves with if it is remembered on the server. Never rejects.
 */
export async function trustChangedKeys(userId: string): Promise<boolean> {
  const sealing = sealer.peek();
  const given = changedKeys.peek().get(userId);
  if (!sealing || !given) return false;
  const seen = await rememberedBy(sealing);
  if (!seen) return false;
  // Not kept. The key remembered before stays. With no entry, the changed key
  // would look like a first sight, and would be trusted.
  if (!(await remember(sealing, seen, given))) return false;
  markChanged(userId, null);
  return true;
}

/**
 * The fingerprint of the keys that the server gives for an account, for two
 * persons to compare, and if they are different from the remembered keys. Null
 * for an account with no keys yet. Never rejects.
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

/**
 * The own keys of this account as the server has them, with the private halves
 * wrapped.
 */
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
 * The key of a note wrapped for a person, or why there is none. `unable` when a
 * new request changes nothing, `failed` when it can. See `SupplyResult`.
 */
async function wrapKeyFor(
  noteId: string,
  recipientId: string,
): Promise<OfferedKey | "unable" | "failed"> {
  const sealing = sealer.peek();
  if (!sealing?.handsKeysOn) return "unable";
  const found = await lookUpKeys(recipientId);
  // An account with no keys yet has nothing to wrap to.
  if (found === "none") return "unable";
  if (found === "failed") return "failed";
  // Only to a key that this account saw for them before, or sees first now.
  const recipient = await trustedKeysOf(recipientId);
  if (!recipient) {
    // A changed key to which nobody agreed, or a list that could not be read.
    // `rememberedBy` forgets a request that failed. Thus, what is still there
    // tells which it was.
    return remembered.has(sealing) ? "unable" : "failed";
  }
  // A note that did not open here is read for its key, which is also a request.
  const held = sealing.holds(noteId);
  try {
    const offered = await sealing.offerKey(
      noteId,
      { userId: recipientId, exchange: recipient.publicKeys.exchange },
      sealedNote(noteId),
      ownKeys,
    );
    // None: the own keys of this account could not be read at this moment.
    return offered ?? "failed";
  } catch (err) {
    console.warn("Failed to wrap a note's key:", err);
    return held ? "unable" : "failed";
  }
}

/**
 * The key of a note of this account, wrapped to the public key of `recipientId`
 * and signed. Null when the recipient has no keys yet, or this device cannot
 * wrap. The invitation then waits for a key.
 */
export async function offerKeyTo(
  noteId: string,
  recipientId: string,
): Promise<OfferedKey | null> {
  const offered = await wrapKeyFor(noteId, recipientId);
  return typeof offered === "string" ? null : offered;
}

/**
 * Takes a key offered to this account. It is checked against the key of the
 * signer, opened, checked against `words` (the sealed fields of the note, which
 * it must open), and wrapped under the own notes key of this account. Null when
 * it does not pass the check or does not open. Then nothing of the note is
 * used.
 */
export async function adoptOfferedKey(
  sealing: NoteSealing,
  noteId: string,
  offered: OfferedKey,
  words: Partial<SharedSealed>,
): Promise<HeldKeyRequest | null> {
  // A sealing that seals nothing also has no signature to check.
  if (!sealing.handsKeysOn) {
    return sealing.adoptOffered(noteId, offered, "", ownKeys, words);
  }
  // Checked against the key remembered for the signer. A key that the server
  // changed since then checks nothing.
  const signer = await trustedKeysOf(offered.signer);
  if (!signer) return null;
  try {
    return await sealing.adoptOffered(
      noteId,
      offered,
      signer.publicKeys.signing,
      ownKeys,
      words,
    );
  } catch (err) {
    console.warn("Failed to open an offered key:", err);
    return null;
  }
}

/**
 * A note whose key was replaced reaches a recipient with the new key offered
 * and no copy of their own. Their client takes the offer and keeps it. Thus,
 * their next device opens the note without this step again.
 */
setOfferHandler(async (sealing, sealed) => {
  if (!sealed.offered) return;
  const held = await adoptOfferedKey(
    sealing,
    sealed.id,
    sealed.offered,
    sealed,
  );
  if (held) void apiFetch("PUT", `/notes/${sealed.id}/held-key`, held);
});

/**
 * The result of the supply of a key to a person. `unable` when there is nothing
 * to give them or nothing to wrap it to (an account with no keys yet, a changed
 * key to which nobody agreed), which a new request does not change. `failed`
 * when a request did not get through, which a new request can change.
 */
export type SupplyResult = "supplied" | "unable" | "failed";

/**
 * Gives `recipientId`, who is on the note and waits, its key. Never rejects.
 */
export async function supplyKey(
  noteId: string,
  recipientId: string,
): Promise<SupplyResult> {
  const offered = await wrapKeyFor(noteId, recipientId);
  if (typeof offered === "string") return offered;
  const res = await apiFetch(
    "PUT",
    `/notes/${noteId}/shares/${encodeURIComponent(recipientId)}/key`,
    offered,
  );
  return res?.ok ? "supplied" : "failed";
}

/**
 * The public links to which the new key of a note must go. A server with public
 * links switched off answers 404 for the listing, and has none to which to give
 * it. The key is replaced anyway, because the departed person still has the old
 * key. Rejects when the listing could not be read.
 */
async function liveLinksOf(noteId: string): Promise<PublicLink[]> {
  try {
    const listed = await apiJson<PublicLinksResponse>(
      "GET",
      `/notes/${noteId}/links`,
    );
    return listed?.links ?? [];
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

/**
 * How many times a replacement is sealed again when the note is written under
 * it, before the code leaves it for the next try.
 */
const REKEY_ATTEMPTS = 3;

/**
 * Gives a note of this account a new key, because a person who had the old key
 * does not have the note now. All that the persons on it share is sealed again,
 * and each live public link gets the new key. The persons still on the note
 * then wait for it, and get it as all other persons who wait. Resolves with if
 * the note is under a new key. Never rejects.
 */
export async function replaceNoteKey(noteId: string): Promise<boolean> {
  const sealing = sealer.peek();
  if (!sealing?.handsKeysOn) return false;
  try {
    for (let attempt = 0; attempt < REKEY_ATTEMPTS; attempt++) {
      const sealed = await sealedNote(noteId)();
      // Not due now: a different device of this account did it first.
      if (!sealed?.rekeyDue) return false;
      const made = await sealing.rekey(sealed, await liveLinksOf(noteId));
      if (!made) return false;
      // The fields were sealed again from the note as just read. The server
      // takes them only if nothing wrote it since then. If not, an edit made in
      // the meantime would be undone.
      const res = await apiFetch("PUT", `/notes/${noteId}/key`, made.body, {
        "If-Match": sealed.updatedAt,
      });
      if (res?.ok) {
        made.commit();
        return true;
      }
      // Written since then (412): read again, and seal the current data.
      if (res?.status !== 412) break;
    }
  } catch (err) {
    console.warn("Failed to replace a note's key:", err);
  }
  // A different device did it, there were too many writes during the tries, or
  // offline. The note stays due, and the caller tries again.
  return false;
}

/**
 * Leaves for a calendar feed the key of a note that has a reminder and no copy
 * for it yet. Resolves with if the server took it. Never rejects.
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
