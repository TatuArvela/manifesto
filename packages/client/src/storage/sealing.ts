import {
  type AccountKeys,
  type HeldKeyRequest,
  type Note,
  type NoteComment,
  type NoteRekeyRequest,
  type NoteVersion,
  noteSealKey,
  type OfferedKey,
  openComment,
  openPreviousKeys,
  openSharedFields,
  openVersion,
  type PublicLink,
  type PublicLinkMode,
  resealSharedFields,
  type SealedAccountPrefs,
  type SealedNote,
  type SealedNoteVersion,
  type SealedNoteVersionCreateRequest,
  type SharedSealed,
  sealComment,
  sealPreviousKeys,
  sealVersion,
  unwrapNoteKey,
  wipe,
  wrapForLink,
  wrapNoteKey,
} from "@manifesto/shared";
import { computed, signal } from "@preact/signals";
import { ulid } from "ulid";
import {
  type NewToken,
  newKeyedToken,
  openPrefs,
  openSeenKeys,
  type SeenKeys,
  sealPrefs,
  sealSeenKeys,
} from "./accountSealing.ts";
import {
  NoteKeyError,
  type NoteKeyRing,
  ringKey,
  toggleIn,
} from "./heldNoteKeys.ts";
import { offerHeldKey, PrivateKeys, takeOfferedKey } from "./keyOffers.ts";
import {
  openPublicLinkKey,
  type SealedPublicLink,
  sealPublicLink,
} from "./linkSealing.ts";
import { NoteSealer } from "./noteSealer.ts";
import type { VersionInput } from "./StorageAdapter.ts";
import { type StorageKeys, storageKeys } from "./storageKeys.ts";

/**
 * The seal and open of all data that goes to the server in connected mode
 * (`docs/specification/features/encryption.md`). A note is sealed here before
 * it goes out, and opened here when it arrives. Thus, no code above the storage
 * layer ever has a ciphertext, and no code below it has a readable note.
 */

/**
 * The sealing of one unlocked account, in three layers: the held keys
 * (`heldNoteKeys.ts`), the notes and their images (`noteSealer.ts`), and here
 * all that is written next to a note under its key. It remembers the key of
 * each note that it opened. Thus, it seals a change to a note without a new
 * unwrap of its key. Nobody can read the keys themselves out of it.
 */
export class Sealer extends NoteSealer {
  /**
   * The private keys of the account, opened the first time that code needs one.
   */
  private readonly privateKeys: PrivateKeys;

  constructor(keys: StorageKeys) {
    super(keys);
    this.privateKeys = new PrivateKeys(keys.accountKey, keys.userId);
  }

  protected override async takeOffer(sealed: SealedNote): Promise<void> {
    if (offerHandler) await offerHandler(this, sealed);
  }

  /**
   * The key of a note of this account, wrapped to the public key of `recipient`
   * and signed as this account. Null when the private keys could not open.
   * Rejects with `NoteKeyError` for a note whose key is not held.
   */
  async offerKey(
    noteId: string,
    recipient: { userId: string; exchange: string },
    fetch: () => Promise<SealedNote | null>,
    load: () => Promise<AccountKeys | null>,
  ): Promise<OfferedKey | null> {
    const own = await this.privateKeys.get(load);
    if (!own) return null;
    const account = await this.account;
    const held = await this.keyOf(noteId, fetch);
    const offered = await offerHeldKey(
      account,
      own.signing,
      noteId,
      { version: held.key.version, wrapped: held.wrapped },
      recipient,
    );
    if (!offered) throw new NoteKeyError(noteId);
    return offered;
  }

  /**
   * Takes a key offered to this account. The code uses it only if its signature
   * passes the check against `signerKey`, the signing key of the account that
   * it says wrapped it. Then the code opens it, and wraps it under the own
   * notes key of this account, which it gives back to store. Null for a key
   * that does not pass the check or does not open. Also null for a key that is
   * not the key of `words`, the sealed fields of the note as the server sent
   * them. The signature tells who wrapped a key, not that it is the key of the
   * note, and all persons on the note can wrap one.
   */
  async adoptOffered(
    noteId: string,
    offered: OfferedKey,
    signerKey: string,
    load: () => Promise<AccountKeys | null>,
    words?: Partial<SharedSealed>,
  ): Promise<HeldKeyRequest | null> {
    const adopted = await takeOfferedKey(
      await this.account,
      noteId,
      offered,
      signerKey,
      async () => (await this.privateKeys.get(load))?.exchange ?? null,
      words,
    );
    if (!adopted) return null;
    this.hold(noteId, { ...adopted, previous: "" });
    return { key: adopted.wrapped, keyVersion: offered.keyVersion };
  }

  /**
   * What an invitation shows of its note, opened with the key adopted for it.
   * Null when no key for the note at `keyVersion` is held.
   */
  async openPreview(
    noteId: string,
    keyVersion: number,
    sealed: { title: string; content: string; font: string },
  ): Promise<Pick<Note, "title" | "content" | "font"> | null> {
    const held = this.noteKeys.get(noteId);
    if (held?.key.version !== keyVersion) return null;
    const { title, content, font } = await openSharedFields(
      held.key,
      noteId,
      sealed,
    );
    return { title, content, font };
  }

  /**
   * The note under a new key, for its owner to send. All that the persons on
   * the note share is sealed again as it is. The new key is wrapped for this
   * account, the previous keys are sealed under it, and the new key is wrapped
   * for each live public link. Null when the note does not open here. Then
   * nothing is replaced. `commit` is called after the server took it.
   */
  async rekey(
    sealed: SealedNote,
    links: readonly PublicLink[],
  ): Promise<{ body: NoteRekeyRequest; commit: () => void } | null> {
    const account = await this.account;
    const id = sealed.id;
    const oldRaw = await unwrapNoteKey(
      account,
      id,
      sealed.keyVersion,
      sealed.key,
    );
    if (!oldRaw) return null;
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const version = sealed.keyVersion + 1;
    const from = await noteSealKey(oldRaw, sealed.keyVersion);
    const previous = await openPreviousKeys(from, id, sealed.previousKeys);
    previous.set(sealed.keyVersion, oldRaw);
    try {
      // The code does not change a note with previous keys that do not open. A
      // replacement of the key would lose what they opened.
      if (sealed.previousKeys && previous.size < 2) return null;
      const key = await noteSealKey(raw, version);
      const fields = await resealSharedFields(from, key, id, sealed);
      if (!fields) return null;
      const wrapped = await wrapNoteKey(account, id, version, raw);
      const previousKeys = await sealPreviousKeys(key, id, previous);
      const rewrapped: { token: string; wrappedKey: string }[] = [];
      for (const link of links) {
        if (link.mode !== "live") continue;
        const linkKey = await this.openLinkKey(id, link.sealedLinkKey);
        // A link whose key does not open here stops to open the note.
        if (!linkKey) continue;
        rewrapped.push({
          token: link.token,
          wrappedKey: await wrapForLink(linkKey, id, version, raw),
        });
      }
      return {
        body: {
          keyVersion: version,
          key: wrapped,
          previousKeys,
          ...fields,
          ...(rewrapped.length > 0 && { links: rewrapped }),
        },
        // Under its new key, the note does not need a new key, which the next
        // read would only say again.
        commit: () => {
          this.hold(id, { key, wrapped, previous: previousKeys });
          toggleIn(this.due, id, false);
        },
      };
    } finally {
      wipe(raw);
      for (const older of previous.values()) wipe(older);
    }
  }

  /** A version to add to the history of a note. */
  async sealVersion(
    noteId: string,
    version: VersionInput,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<SealedNoteVersionCreateRequest> {
    const { key } = await this.keyOf(noteId, fetch);
    const id = ulid();
    return {
      id,
      ...(await sealVersion(key, id, version, this.images.byRef)),
      ...(version.timestamp !== undefined && { timestamp: version.timestamp }),
    };
  }

  /**
   * The versions that open, newest first as they came, each with the key under
   * which it was written: that of the note, or a previous key.
   */
  async openVersions(
    noteId: string,
    sealed: SealedNoteVersion[],
    fetch: () => Promise<SealedNote | null>,
  ): Promise<NoteVersion[]> {
    if (sealed.length === 0) return [];
    const ring = await this.ringOf(noteId, fetch);
    const out: NoteVersion[] = [];
    for (const version of sealed) {
      const key = ringKey(ring, version.keyVersion);
      const opened = key ? await openVersion(key, version) : null;
      if (opened) {
        // A restore seals the images of the version again for the note.
        const { imageKeys, ...plain } = opened;
        this.images.keepAll(imageKeys);
        out.push(plain);
      }
    }
    return out;
  }

  /**
   * The keys with which the shared document of a note is read and written. Its
   * edits, snapshots and cursors are sealed under the key of the note. What was
   * written before the key was replaced opens with the previous key. Rejects
   * with `NoteKeyError` for a note whose key this device does not have.
   */
  async documentKey(
    noteId: string,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<NoteKeyRing | null> {
    return this.ringOf(noteId, fetch);
  }

  /** What the publication of a note needs. See `sealPublicLink`. */
  async publish(
    note: Pick<
      Note,
      | "id"
      | "title"
      | "content"
      | "font"
      | "images"
      | "imageAlts"
      | "linkPreviews"
    >,
    mode: PublicLinkMode,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<SealedPublicLink | null> {
    const account = await this.account;
    const noteKey = async () => {
      const held = await this.keyOf(note.id, fetch);
      const version = held.key.version;
      const raw = await unwrapNoteKey(account, note.id, version, held.wrapped);
      if (!raw) throw new NoteKeyError(note.id);
      return { version, raw };
    };
    return sealPublicLink(account, note, mode, noteKey, this.images.byRef);
  }

  /**
   * The key of a link, from the copy sealed for its owner. Null when it does
   * not open.
   */
  async openLinkKey(noteId: string, sealed: string): Promise<string | null> {
    return openPublicLinkKey(await this.account, noteId, sealed);
  }

  /** A new token that carries keys (`newKeyedToken`). */
  async newToken(
    prefix: string,
    carries: "notes" | "reminders" = "notes",
  ): Promise<NewToken | null> {
    return newKeyedToken(this.keys, prefix, carries);
  }

  /**
   * The text of a comment, sealed under the key of its note and bound to `id`.
   */
  async sealComment(
    noteId: string,
    id: string,
    body: string,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<{ body: string; keyVersion: number }> {
    const { key } = await this.keyOf(noteId, fetch);
    return sealComment(key, id, body);
  }

  /**
   * The comments that open, as they came, each with the key under which it was
   * written: that of the note, or a previous key.
   */
  async openComments(
    noteId: string,
    sealed: NoteComment[],
    fetch: () => Promise<SealedNote | null>,
  ): Promise<NoteComment[]> {
    if (sealed.length === 0) return [];
    const ring = await this.ringOf(noteId, fetch);
    const out: NoteComment[] = [];
    for (const comment of sealed) {
      const key = ringKey(ring, comment.keyVersion);
      const body = key ? await openComment(key, comment) : null;
      if (body !== null) out.push({ ...comment, body });
    }
    return out;
  }

  async sealSeenKeys(peerId: string, keys: SeenKeys): Promise<string> {
    return sealSeenKeys(await this.account, peerId, keys);
  }

  async openSeenKeys(
    sealed: Record<string, string>,
  ): Promise<Map<string, SeenKeys>> {
    return openSeenKeys(await this.account, sealed);
  }

  async sealPrefs(
    prefs: Record<string, unknown>,
  ): Promise<Record<string, string | null>> {
    return sealPrefs(await this.account, prefs);
  }

  async openPrefs(
    sealed: SealedAccountPrefs,
  ): Promise<Record<string, unknown>> {
    return openPrefs(await this.account, sealed);
  }
}

/**
 * What the storage layer seals and opens with: `Sealer`, as its callers see it.
 */
export type NoteSealing = Pick<Sealer, keyof Sealer>;

/** What takes a key offered with a note. See `storage/shareKeys.ts`. */
type OfferHandler = (sealing: NoteSealing, sealed: SealedNote) => Promise<void>;

let offerHandler: OfferHandler | null = null;

/**
 * Set by `storage/shareKeys.ts`, which knows how to ask the server for the key
 * of the signer. The sealing itself must not make a request.
 */
export function setOfferHandler(handler: OfferHandler | null): void {
  offerHandler = handler;
}

const forTests = signal<NoteSealing | null>(null);

/**
 * Puts a different sealing in place of that of the account, for tests of the
 * code above storage (`test/plainSealing.ts`). Null removes it again.
 */
export function setSealingForTests(sealing: NoteSealing | null): void {
  forTests.value = sealing;
}

/**
 * The sealing of the account that is unlocked now. Null while locked, in open
 * mode, and while signed out.
 */
export const sealer = computed<NoteSealing | null>(
  () =>
    forTests.value ??
    (storageKeys.value ? new Sealer(storageKeys.value) : null),
);
