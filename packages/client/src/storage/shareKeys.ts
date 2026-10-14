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
import type { SeenKeys } from "./accountSealing.js";
import { ApiError, apiFetch, apiJson } from "./apiRequest.js";
import { type NoteSealing, sealer, setOfferHandler } from "./sealing.js";

/**
 * Handing a shared note's key from account to account
 * (`docs/specification/features/encryption.md`, "Sharing"): the requests
 * around what `Sealer` wraps, checks and opens. Apart from `sealing.ts`
 * because these reach the server through `apiRequest.ts`, which the sealing
 * itself must not import.
 */

/** What asking for an account's public keys came to: its keys, `none` for
 * an account not set up yet, or `failed` when the request did not get
 * through. */
type KeysLookup = AccountPublicKeysResponse | "none" | "failed";

/**
 * Each account's public keys, as the server gave them to the sealing in
 * `cachedFor`. Only keys are kept: an account with none yet may set them up
 * at any moment, and a request that failed is asked again. Another account
 * unlocked (or the same one unlocked again) starts with nothing kept.
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

/** An account's public keys, or null when it has none yet or they could not
 * be read. */
export async function publicKeysOf(
  userId: string,
): Promise<AccountPublicKeysResponse | null> {
  const found = await lookUpKeys(userId);
  return typeof found === "string" ? null : found;
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

/**
 * Remembers `given` as the account's keys, on the server and then here. A key
 * the server did not keep is not remembered at all: in the next session it
 * would be met as a first sight, and so would whatever key the server gave
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
    if (await remember(sealing, seen, given)) return given;
    // Not kept, so not taken. The list is read again next time, which also
    // marks this as worth trying again (`wrapKeyFor`).
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
  // Not kept, the key remembered before stays: with no entry the changed
  // key would be met as a first sighting, and trusted.
  if (!(await remember(sealing, seen, given))) return false;
  markChanged(userId, null);
  return true;
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
 * A note's key wrapped for someone, or why there is none: `unable` when
 * asking again changes nothing, `failed` when it may. See `SupplyResult`.
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
  // Only to a key this account has seen for them before, or sees first now.
  const recipient = await trustedKeysOf(recipientId);
  if (!recipient) {
    // A changed key nobody has agreed to, or a list that could not be read:
    // `rememberedBy` forgets a request that failed, so what is still there
    // says which it was.
    return remembered.has(sealing) ? "unable" : "failed";
  }
  // A note not opened here is read for its key, which is a request too.
  const held = sealing.holds(noteId);
  try {
    const offered = await sealing.offerKey(
      noteId,
      { userId: recipientId, exchange: recipient.publicKeys.exchange },
      sealedNote(noteId),
      ownKeys,
    );
    // None: this account's own keys could not be read just now.
    return offered ?? "failed";
  } catch (err) {
    console.warn("Failed to wrap a note's key:", err);
    return held ? "unable" : "failed";
  }
}

/**
 * The key of a note this account holds, wrapped to `recipientId`'s public
 * key and signed. Null when the recipient has no keys yet, or this device
 * cannot wrap: the invitation then waits for a key.
 */
export async function offerKeyTo(
  noteId: string,
  recipientId: string,
): Promise<OfferedKey | null> {
  const offered = await wrapKeyFor(noteId, recipientId);
  return typeof offered === "string" ? null : offered;
}

/**
 * Takes a key offered to this account: checked against the signer's key,
 * opened, held to `words` (the note's sealed fields, which it has to open),
 * and wrapped under this account's own notes key. Null when it does not
 * check or open, and then nothing of the note is used.
 */
export async function adoptOfferedKey(
  sealing: NoteSealing,
  noteId: string,
  offered: OfferedKey,
  words: Partial<SharedSealed>,
): Promise<HeldKeyRequest | null> {
  // Sealing that seals nothing has no signature to check either.
  if (!sealing.handsKeysOn) {
    return sealing.adoptOffered(noteId, offered, "", ownKeys, words);
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
      words,
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
  const held = await adoptOfferedKey(
    sealing,
    sealed.id,
    sealed.offered,
    sealed,
  );
  if (held) void apiFetch("PUT", `/notes/${sealed.id}/held-key`, held);
});

/**
 * How handing someone a key went: `unable` when there is nothing to hand
 * them or nothing to wrap it to (an account with no keys yet, a changed key
 * nobody has agreed to), which asking again does not change; `failed` when a
 * request did not get through, which it may.
 */
export type SupplyResult = "supplied" | "unable" | "failed";

/** Hands `recipientId`, who is on the note and waiting, its key. Never
 * rejects. */
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
 * The public links a note's new key has to be handed to. A server with
 * public links switched off answers 404 for the listing, and has none to
 * hand it to: the key is replaced all the same, since the person who left
 * still holds the old one. Rejects when the listing could not be read.
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
      const made = await sealing.rekey(sealed, await liveLinksOf(noteId));
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
