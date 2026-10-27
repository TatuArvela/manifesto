import {
  type AccountKeys,
  type AccountSealKeys,
  changesWords,
  currentNoteFormat,
  type HeldKeyRequest,
  type ImageKey,
  isNewerNoteFormat,
  type Note,
  type NoteComment,
  type NoteCreate,
  type NoteRekeyRequest,
  type NoteSealKey,
  type NoteUpdate,
  type NoteVersion,
  noteSealKey,
  type OfferedKey,
  openComment,
  openNoteKey,
  openPreviousKeys,
  openSealedNote,
  openSharedFields,
  openVersion,
  type PublicLink,
  type PublicLinkMode,
  resealSharedFields,
  SEALED_SHARED_NOTE_FIELDS,
  type SealedAccountPrefs,
  type SealedNote,
  type SealedNoteCreate,
  type SealedNoteUpdate,
  type SealedNoteVersion,
  type SealedNoteVersionCreateRequest,
  type SharedSealed,
  sealComment,
  sealNewNote,
  sealNoteUpdate,
  sealPersonalFields,
  sealPreviousKeys,
  sealSharedFields,
  sealVersion,
  unwrapNoteKey,
  wipe,
  withEveryWord,
  wrapForLink,
  wrapForReminders,
  wrapNoteKey,
} from "@manifesto/shared";
import { computed, type Signal, signal } from "@preact/signals";
import { ulid } from "ulid";
import { accountImageKeys, accountSubkey } from "#/utils/keyMaterial.ts";
import {
  type NewToken,
  newKeyedToken,
  openPrefs,
  openSeenKeys,
  type SeenKeys,
  sealPrefs,
  sealSeenKeys,
} from "./accountSealing.ts";
import { ImageKeyRing, type ImageUpload } from "./imageKeyRing.ts";
import { offerHeldKey, PrivateKeys, takeOfferedKey } from "./keyOffers.ts";
import {
  openPublicLinkKey,
  type SealedPublicLink,
  sealPublicLink,
} from "./linkSealing.ts";
import type { VersionInput } from "./StorageAdapter.ts";

/**
 * The seal and open of all data that goes to the server in connected mode
 * (`docs/specification/features/encryption.md`). A note is sealed here before
 * it goes out, and opened here when it arrives. Thus, no code above the storage
 * layer ever has a ciphertext, and no code below it has a readable note.
 */

/** The key of the unlocked account, as the device has it. */
export interface StorageKeys {
  userId: string;
  /** The version of the account key. */
  version: number;
  /** It derives, and cannot be read out. */
  accountKey: CryptoKey;
}

/**
 * Set by `state/account/accountKeys.ts` while the account is unlocked, and null
 * otherwise. Pushed in for the same reason as `storageConnection`: storage
 * never imports the state that knows about the unlock.
 */
export const storageKeys = signal<StorageKeys | null>(null);

/** A write that could not be sealed because the account is locked. */
export class LockedError extends Error {
  constructor() {
    super("The account is locked");
    this.name = "LockedError";
  }
}

/** A note whose key this device did not open. Thus, it cannot be written. */
export class NoteKeyError extends Error {
  constructor(public readonly noteId: string) {
    super("The note's key could not be opened");
    this.name = "NoteKeyError";
  }
}

/**
 * What is known of the key of a note: the key to use, and its wrapped copy as
 * the server has it.
 */
interface HeldNoteKey {
  key: NoteSealKey;
  wrapped: string;
  /** The keys before this one, as the note carries them sealed. */
  previous: string;
  /** Those keys opened, the first time that code reads something under one. */
  older?: Promise<ReadonlyMap<number, NoteSealKey>>;
}

/** How many notes of a listing are in their open at each moment. */
const OPENED_AT_ONCE = 8;

/**
 * The key of a note, and its previous keys. Together, they open all data
 * written next to the note, whenever it was written.
 */
export interface NoteKeyRing {
  key: NoteSealKey;
  older: ReadonlyMap<number, NoteSealKey>;
}

function ringKey(ring: NoteKeyRing, version: number): NoteSealKey | null {
  return version === ring.key.version
    ? ring.key
    : (ring.older.get(version) ?? null);
}

/** Puts `id` in the set that `held` has, or removes it. */
function toggleIn(
  held: Signal<ReadonlySet<string>>,
  id: string,
  on: boolean,
): void {
  const now = held.peek();
  if (now.has(id) === on) return;
  const next = new Set(now);
  if (on) next.add(id);
  else next.delete(id);
  held.value = next;
}

/**
 * The sealing of one unlocked account. It remembers the key of each note that
 * it opened. Thus, it seals a change to a note without a new unwrap of its key.
 * Nobody can read the keys themselves out of it.
 */
export class Sealer {
  private readonly account: Promise<AccountSealKeys>;
  /** Wraps the key of each note that has a reminder, for a calendar feed. */
  private readonly reminders: Promise<CryptoKey>;
  private readonly noteKeys = new Map<string, HeldNoteKey>();
  /** What opens each image that this device saw, by its reference. */
  private readonly images: ImageKeyRing;
  /**
   * If the images of a note must be made the property of its owner before it
   * names them (`POST /api/v1/attachments/claim`).
   */
  readonly claimsImages: boolean = true;
  /** If the key of a shared note is wrapped for the persons on it. */
  readonly handsKeysOn: boolean = true;
  private readonly keys: StorageKeys;
  /**
   * The private keys of the account, opened the first time that code needs one.
   */
  private readonly privateKeys: PrivateKeys;
  /**
   * Notes that arrived and did not open, by id: what the board says that it
   * does not show (`UnopenedNotes`).
   */
  readonly unreadable = signal<ReadonlySet<string>>(new Set());
  /**
   * Notes that arrived in a format newer than this build reads, by id. A newer
   * version of the app saved them. Thus, this version must be reloaded to show
   * them (`UnopenedNotes`).
   */
  readonly newer = signal<ReadonlySet<string>>(new Set());
  /** The notes of both kinds that this account owns. */
  private readonly unopenedOwn = new Set<string>();
  /** The format in which each note opened here is stored. */
  private readonly formats = new Map<string, number>();
  /**
   * The notes that this account owns that need a new key: a person who had
   * their current key does not have the note now.
   */
  readonly due = signal<ReadonlySet<string>>(new Set());
  /**
   * The notes with a reminder that a calendar feed cannot name yet: no copy of
   * their key is under the reminder key of this account. A reminder that a
   * script set leaves a note in this state, and so does a replaced note key.
   */
  readonly feedDue = signal<ReadonlySet<string>>(new Set());
  /**
   * The key version of each note whose key was replaced while it was open here.
   * Thus, all that has the old key (a live document) starts again.
   */
  readonly replaced = signal<ReadonlyMap<string, number>>(new Map());
  /**
   * If a full listing was opened. Thus, the key of each note of the account is
   * available. An import needs that before it seals, because a note that is
   * already there is written over under its current key.
   */
  complete = false;

  constructor(keys: StorageKeys) {
    this.keys = keys;
    this.account = (async () => ({
      userId: keys.userId,
      version: keys.version,
      notes: await accountSubkey(keys.accountKey, "notes"),
      personal: await accountSubkey(keys.accountKey, "personal"),
    }))();
    this.images = new ImageKeyRing(accountImageKeys(keys.accountKey));
    this.privateKeys = new PrivateKeys(keys.accountKey, keys.userId);
    this.reminders = accountSubkey(keys.accountKey, "reminder");
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
   * An image sealed for upload. Rejects with `ImageKindError` for a file that
   * is not an image that a note can contain.
   */
  sealUpload(image: Blob): Promise<ImageUpload> {
    return this.images.seal(image);
  }

  /** Keeps what opens the image that the server just named `ref`. */
  keepImageKey(ref: string, key: ImageKey | null): void {
    this.images.keep(ref, key);
  }

  /**
   * What opens the image that `ref` names, or null when this device has none.
   */
  imageKeyOf(ref: string): ImageKey | null {
    return this.images.keyOf(ref);
  }

  /**
   * `to` is the same sealed image as `from`, stored again for the owner of a
   * note.
   */
  sameImage(from: string, to: string): void {
    this.images.same(from, to);
  }

  /** The image that `ref` names, from its sealed bytes. */
  openDownload(ref: string, sealed: Blob): Promise<Blob> {
    return this.images.open(ref, sealed);
  }

  /** Keeps the key of a note, and tells when it is not the key held before. */
  private hold(id: string, held: HeldNoteKey): void {
    const before = this.noteKeys.get(id);
    this.noteKeys.set(id, held);
    if (before && before.key.version !== held.key.version) {
      const next = new Map(this.replaced.value);
      next.set(id, held.key.version);
      this.replaced.value = next;
    }
  }

  /**
   * A held note key wrapped under the reminder key: the copy with which a
   * calendar feed opens the note.
   */
  private async wrappedForFeed(id: string, held: HeldNoteKey): Promise<string> {
    const account = await this.account;
    const raw = await unwrapNoteKey(
      account,
      id,
      held.key.version,
      held.wrapped,
    );
    if (!raw) throw new NoteKeyError(id);
    try {
      return await wrapForReminders(
        await this.reminders,
        account,
        id,
        held.key.version,
        raw,
      );
    } finally {
      wipe(raw);
    }
  }

  /**
   * The copy of the key of a note for the calendar feeds of this account, to
   * store with a note that has a reminder and no copy yet.
   */
  async feedKey(
    id: string,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<string> {
    return this.wrappedForFeed(id, await this.keyOf(id, fetch));
  }

  /**
   * The note as its reader sees it, in the current format. Null when its key
   * does not open, or when it is in a format newer than this build reads.
   */
  async open(sealed: SealedNote): Promise<Note | null> {
    const owned = (sealed.sharing?.role ?? "owner") === "owner";
    if (isNewerNoteFormat(sealed.format)) {
      toggleIn(this.newer, sealed.id, true);
      if (owned) this.unopenedOwn.add(sealed.id);
      return null;
    }
    toggleIn(this.newer, sealed.id, false);
    const account = await this.account;
    // No copy of the key of their own, and one offered: take it first, unless
    // it was already taken and the server did not store the copy yet.
    if (
      sealed.key === "" &&
      sealed.offered &&
      offerHandler &&
      this.noteKeys.get(sealed.id)?.key.version !== sealed.offered.keyVersion
    ) {
      await offerHandler(this, sealed);
    }
    const known = this.noteKeys.get(sealed.id);
    const opened = await openSealedNote(
      account,
      sealed,
      // The same wrapped copy as last time, or a key just taken from an offer,
      // which the server does not have yet: no unwrap is necessary. A key of a
      // different version is not the key of the note now.
      known &&
        known.key.version === sealed.keyVersion &&
        (known.wrapped === sealed.key || sealed.key === "")
        ? known.key
        : undefined,
    );
    if (!opened) {
      // Under a key that was replaced, and the new key is not here yet. The old
      // key seals nothing more.
      if (known && known.key.version !== sealed.keyVersion) {
        this.noteKeys.delete(sealed.id);
      }
      toggleIn(this.unreadable, sealed.id, true);
      if (owned) this.unopenedOwn.add(sealed.id);
      return null;
    }
    this.formats.set(sealed.id, sealed.format);
    const previous = sealed.previousKeys ?? "";
    if (
      known?.key === opened.key &&
      known.wrapped === sealed.key &&
      known.previous === previous
    ) {
      // As already held: kept, with the earlier keys that it opened.
    } else if (sealed.key !== "") {
      this.hold(sealed.id, { key: opened.key, wrapped: sealed.key, previous });
    } else if (known && known.previous !== previous) {
      this.noteKeys.set(sealed.id, {
        key: known.key,
        wrapped: known.wrapped,
        previous,
      });
    }
    toggleIn(this.due, sealed.id, sealed.rekeyDue === true);
    toggleIn(
      this.feedDue,
      sealed.id,
      sealed.reminder !== null &&
        !sealed.reminderKey &&
        this.noteKeys.has(sealed.id),
    );
    this.images.keepAll(opened.imageKeys);
    toggleIn(this.unreadable, sealed.id, false);
    this.unopenedOwn.delete(sealed.id);
    return opened.note;
  }

  /** Each note of a listing that opens, in order, a few at a time. */
  async openAll(sealed: SealedNote[]): Promise<Note[]> {
    const opened = new Array<Note | null>(sealed.length).fill(null);
    let next = 0;
    const work = async () => {
      while (next < sealed.length) {
        const index = next++;
        const note = sealed[index];
        if (note) opened[index] = await this.open(note);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(OPENED_AT_ONCE, sealed.length) }, work),
    );
    return opened.filter((note) => note !== null);
  }

  markComplete(): void {
    this.complete = true;
  }

  /** If a note with this id was opened here. */
  holds(id: string): boolean {
    return this.noteKeys.has(id);
  }

  /**
   * If a note that this account owns arrived and did not open. A backup made
   * now would not include it.
   */
  missesOwnNotes(): boolean {
    return this.unopenedOwn.size > 0;
  }

  /**
   * The key of a note does not apply now: the note was deleted, or taken away.
   */
  forget(id: string): void {
    this.noteKeys.delete(id);
    this.unopenedOwn.delete(id);
    this.formats.delete(id);
    toggleIn(this.unreadable, id, false);
    toggleIn(this.newer, id, false);
    toggleIn(this.due, id, false);
    toggleIn(this.feedDue, id, false);
  }

  /** A new note under a new key and `id`. */
  async sealNew(id: string, note: NoteCreate): Promise<SealedNoteCreate> {
    const { sealed, key } = await sealNewNote(
      await this.account,
      id,
      note,
      this.images.byRef,
    );
    const held = { key, wrapped: sealed.key, previous: "" };
    this.hold(id, held);
    return note.reminder
      ? { ...sealed, reminderKey: await this.wrappedForFeed(id, held) }
      : sealed;
  }

  /**
   * The key of a note that is already on the server. `fetch` reads the note
   * when this device did not open it yet.
   */
  private async keyOf(
    id: string,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<HeldNoteKey> {
    const known = this.noteKeys.get(id);
    if (known) return known;
    const sealed = await fetch();
    if (sealed) {
      const key = await openNoteKey(
        await this.account,
        id,
        sealed.keyVersion,
        sealed.key,
      );
      if (key) {
        const held = {
          key,
          wrapped: sealed.key,
          previous: sealed.previousKeys ?? "",
        };
        this.hold(id, held);
        this.formats.set(id, sealed.format);
        return held;
      }
    }
    throw new NoteKeyError(id);
  }

  /** The key of a note with its previous keys, opened one time and kept. */
  private async ringOf(
    id: string,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<NoteKeyRing> {
    const held = await this.keyOf(id, fetch);
    held.older ??= (async () => {
      const older = new Map<number, NoteSealKey>();
      const raws = await openPreviousKeys(held.key, id, held.previous);
      for (const [version, raw] of raws) {
        older.set(version, await noteSealKey(raw, version));
        wipe(raw);
      }
      return older;
    })();
    return { key: held.key, older: await held.older };
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

  /**
   * `changes`, with all words of the note when it is stored in a format older
   * than this build writes and they change one of them. The server keeps one
   * format for all words of a note. Thus, the other words come from the note as
   * it is read now, updated.
   */
  private async inCurrentFormat(
    id: string,
    changes: NoteUpdate,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<NoteUpdate> {
    const stored = this.formats.get(id) ?? currentNoteFormat();
    if (stored >= currentNoteFormat() || !changesWords(changes)) {
      return changes;
    }
    const sealed = await fetch();
    const note = sealed ? await this.open(sealed) : null;
    if (!note) throw new NoteKeyError(id);
    return withEveryWord(note, changes);
  }

  /** The changes to a note, with the words among them sealed. */
  async sealUpdate(
    id: string,
    changes: NoteUpdate,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<SealedNoteUpdate> {
    const held = await this.keyOf(id, fetch);
    const { key } = held;
    const sealed = await sealNoteUpdate(
      await this.account,
      key,
      id,
      await this.inCurrentFormat(id, changes, fetch),
      this.images.byRef,
    );
    // A reminder is set. The key of the note goes under the reminder key with
    // it. Thus, a calendar feed can name the event.
    if (changes.reminder) {
      sealed.reminderKey = await this.wrappedForFeed(id, held);
    }
    // Words under the note key tell which key. Thus, the server can refuse them
    // after the note went away from that key.
    const shared = SEALED_SHARED_NOTE_FIELDS.some((field) => field in sealed);
    return shared ? { ...sealed, keyVersion: key.version } : sealed;
  }

  /**
   * A full note written over a note that this account already has, as an import
   * does. Under the current key of the note. Thus, its versions and its
   * document stay readable.
   */
  async sealOver(id: string, note: NoteCreate): Promise<SealedNoteCreate> {
    const held = this.noteKeys.get(id);
    if (!held) return this.sealNew(id, note);
    const account = await this.account;
    const {
      title,
      content,
      font,
      images,
      imageAlts,
      linkPreviews,
      color,
      tags,
      ...rest
    } = note;
    const shared = await sealSharedFields(
      held.key,
      id,
      {
        title,
        content,
        font,
        images,
        ...(imageAlts !== undefined && { imageAlts }),
        linkPreviews,
      },
      this.images.byRef,
    );
    const personal = await sealPersonalFields(account, id, { color, tags });
    return {
      ...rest,
      id,
      key: held.wrapped,
      keyVersion: held.key.version,
      format: currentNoteFormat(),
      ...shared,
      ...personal,
      ...(note.reminder && {
        reminderKey: await this.wrappedForFeed(id, held),
      }),
    } as SealedNoteCreate;
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
