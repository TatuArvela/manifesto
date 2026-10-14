import {
  type AccountKeys,
  type AccountSealKeys,
  deriveBytes,
  type HeldKeyRequest,
  type ImageKey,
  type ImageKeySource,
  type Note,
  type NoteComment,
  type NoteCreate,
  type NoteRekeyRequest,
  type NoteSealKey,
  type NoteUpdate,
  type NoteVersion,
  newLinkKey,
  newTokenSecret,
  noteSealKey,
  type OfferedKey,
  offerNoteKey,
  openComment,
  openImage,
  openNoteKey,
  openOfferedKey,
  openPref,
  openPreviousKeys,
  openSealedNote,
  openSharedFields,
  opensSharedFields,
  openVersion,
  type PublicLink,
  type PublicLinkCreateRequest,
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
  sealImage,
  sealNewNote,
  sealNoteUpdate,
  sealPersonalFields,
  sealPref,
  sealPreviousKeys,
  sealSharedFields,
  sealVersion,
  snapshotKey,
  tokenHashOf,
  unwrapNoteKey,
  verifyOfferedKey,
  wipe,
  wrapFeedKey,
  wrapForLink,
  wrapForReminders,
  wrapNoteKey,
  wrapTokenKeys,
} from "@manifesto/shared";
import { computed, type Signal, signal } from "@preact/signals";
import { ulid } from "ulid";
import {
  accountImageKeys,
  accountSubkey,
  openPrivateKey,
} from "../utils/keyMaterial.js";

/**
 * Sealing and opening for everything that crosses to the server in connected
 * mode (`docs/specification/features/encryption.md`). A note is sealed here
 * before it leaves and opened here when it arrives, so nothing above the
 * storage layer ever holds a ciphertext, and nothing below it a readable
 * note.
 */

/** The unlocked account's key, as the device holds it. */
export interface StorageKeys {
  userId: string;
  /** The version of the account key. */
  version: number;
  /** Derives, and cannot be read out. */
  accountKey: CryptoKey;
}

/**
 * Set by `state/accountKeys.ts` while the account is unlocked, and null
 * otherwise. Pushed in for the same reason as `storageConnection`: storage
 * never imports the state that knows about unlocking.
 */
export const storageKeys = signal<StorageKeys | null>(null);

/** A write that could not be sealed because the account is locked. */
export class LockedError extends Error {
  constructor() {
    super("The account is locked");
    this.name = "LockedError";
  }
}

/** A note whose key this device has not opened, so it cannot be written. */
export class NoteKeyError extends Error {
  constructor(public readonly noteId: string) {
    super("The note's key could not be opened");
    this.name = "NoteKeyError";
  }
}

/** An image that is not one of the kinds a note may hold, whatever the file
 * was called. */
export class ImageKindError extends Error {
  constructor() {
    super("Not a PNG, JPEG, GIF, WebP or AVIF image");
    this.name = "ImageKindError";
  }
}

/** An image as it goes to the server: what to send, and with which headers. */
export interface ImageUpload {
  body: Blob;
  headers: Record<string, string>;
  /** What opens it, to keep once the server has named it; null when it was
   * sent as it is. */
  key: ImageKey | null;
}

/** What is known of a note's key: the key to use, and its wrapped copy as
 * the server holds it. */
interface HeldNoteKey {
  key: NoteSealKey;
  wrapped: string;
  /** The keys before this one, as the note carries them sealed. */
  previous: string;
  /** Those keys opened, the first time something under one is read. */
  older?: Promise<ReadonlyMap<number, NoteSealKey>>;
}

/** How many notes of a listing are being opened at any moment. */
const OPENED_AT_ONCE = 8;

/** An account's public keys as another account remembers having seen them. */
export interface SeenKeys {
  version: number;
  exchange: string;
  signing: string;
}

/** A note's key, and the ones it was under before: what opens anything
 * written beside the note, whenever it was written. */
export interface NoteKeyRing {
  key: NoteSealKey;
  older: ReadonlyMap<number, NoteSealKey>;
}

function ringKey(ring: NoteKeyRing, version: number): NoteSealKey | null {
  return version === ring.key.version
    ? ring.key
    : (ring.older.get(version) ?? null);
}

/**
 * One unlocked account's sealing. It remembers the key of every note it has
 * opened, so a change to a note is sealed without unwrapping its key again;
 * the keys themselves cannot be read out of it.
 */
/** Puts `id` in the set `held` holds, or takes it out. */
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

export class Sealer {
  private readonly account: Promise<AccountSealKeys>;
  private readonly images: Promise<ImageKeySource>;
  /** Wraps the key of each note that has a reminder, for a calendar feed. */
  private readonly reminders: Promise<CryptoKey>;
  private readonly noteKeys = new Map<string, HeldNoteKey>();
  /**
   * What opens each image this device has met, by its reference: from every
   * note opened, and every image uploaded. A note in the app names its
   * images by reference alone, and this is where their keys wait to be
   * sealed back into it.
   */
  private readonly imageKeys = new Map<string, ImageKey>();
  /** Whether a note's images have to be made its owner's before it names
   * them (`POST /api/attachments/claim`). */
  readonly claimsImages: boolean = true;
  /** Whether a shared note's key is wrapped for the people on it. */
  readonly handsKeysOn: boolean = true;
  private readonly keys: StorageKeys;
  /** The account's private keys, opened the first time one is needed. */
  private privateKeys: Promise<{
    exchange: CryptoKey;
    signing: CryptoKey;
  } | null> | null = null;
  /** Notes that arrived and did not open, by id: what the board says it
   * is not showing (`UnopenedNotes`). */
  readonly unreadable = signal<ReadonlySet<string>>(new Set());
  /**
   * The notes this account owns that are due a new key: someone who held
   * the one they are under no longer holds the note.
   */
  readonly due = signal<ReadonlySet<string>>(new Set());
  /**
   * The notes with a reminder that a calendar feed cannot name yet: no copy
   * of their key is under this account's reminder key. A reminder set by a
   * script leaves one so, and so does a replaced note key.
   */
  readonly feedDue = signal<ReadonlySet<string>>(new Set());
  /**
   * The key version of each note whose key was replaced while it was open
   * here, so that whatever holds the old key (a live document) starts again.
   */
  readonly replaced = signal<ReadonlyMap<string, number>>(new Map());
  /**
   * Whether a whole listing has been opened, so the key of every note the
   * account holds is at hand. An import needs that before it seals: a note
   * already there is written over under the key it has.
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
    this.images = accountImageKeys(keys.accountKey);
    this.reminders = accountSubkey(keys.accountKey, "reminder");
  }

  /**
   * The account's two private keys, opened with the account key from what
   * the server holds wrapped (`load`). Null when they could not be read or
   * do not open; asked again the next time, then.
   */
  private async ownPrivateKeys(load: () => Promise<AccountKeys | null>) {
    this.privateKeys ??= (async () => {
      // A failure is a null too, or it would be kept and answered to every
      // later caller until the account is unlocked again.
      try {
        return await this.openPrivateKeys(load);
      } catch (err) {
        console.warn("Failed to open this account's private keys:", err);
        return null;
      }
    })();
    const opened = await this.privateKeys;
    if (!opened) this.privateKeys = null;
    return opened;
  }

  private async openPrivateKeys(load: () => Promise<AccountKeys | null>) {
    const held = await load();
    if (!held) return null;
    const { accountKey, userId } = this.keys;
    const exchange = await openPrivateKey(accountKey, userId, held, "exchange");
    const signing = await openPrivateKey(accountKey, userId, held, "signing");
    return exchange && signing ? { exchange, signing } : null;
  }

  /**
   * The key of a note this account holds, wrapped to `recipient`'s public
   * key and signed as this account. Null when the private keys could not be
   * opened; rejects with `NoteKeyError` for a note whose key is not held.
   */
  async offerKey(
    noteId: string,
    recipient: { userId: string; exchange: string },
    fetch: () => Promise<SealedNote | null>,
    load: () => Promise<AccountKeys | null>,
  ): Promise<OfferedKey | null> {
    const own = await this.ownPrivateKeys(load);
    if (!own) return null;
    const account = await this.account;
    const held = await this.keyOf(noteId, fetch);
    const raw = await unwrapNoteKey(
      account,
      noteId,
      held.key.version,
      held.wrapped,
    );
    if (!raw) throw new NoteKeyError(noteId);
    try {
      return await offerNoteKey(
        { noteId, recipientId: recipient.userId },
        held.key.version,
        raw,
        recipient.exchange,
        { userId: this.keys.userId, signing: own.signing },
      );
    } finally {
      wipe(raw);
    }
  }

  /**
   * Takes a key offered to this account. It is used only if its signature
   * checks against `signerKey`, the signing key of the account it says
   * wrapped it; then it is opened and wrapped under this account's own notes
   * key, which is what is handed back to store. Null for one that does not
   * check or does not open, and for one that is not the key of `words`, the
   * note's sealed fields as the server sent them: the signature says who
   * wrapped a key, not that it is the note's, and anyone on the note may
   * wrap one.
   */
  async adoptOffered(
    noteId: string,
    offered: OfferedKey,
    signerKey: string,
    load: () => Promise<AccountKeys | null>,
    words?: Partial<SharedSealed>,
  ): Promise<HeldKeyRequest | null> {
    const context = { noteId, recipientId: this.keys.userId };
    if (!(await verifyOfferedKey(context, offered, signerKey))) return null;
    const own = await this.ownPrivateKeys(load);
    if (!own) return null;
    const raw = await openOfferedKey(context, offered, own.exchange);
    if (!raw) return null;
    try {
      const key = await noteSealKey(raw, offered.keyVersion);
      if (words && !(await opensSharedFields(key, noteId, words))) return null;
      const wrapped = await wrapNoteKey(
        await this.account,
        noteId,
        offered.keyVersion,
        raw,
      );
      this.hold(noteId, { key, wrapped, previous: "" });
      return { key: wrapped, keyVersion: offered.keyVersion };
    } finally {
      wipe(raw);
    }
  }

  /**
   * What an invitation shows of its note, opened with the key adopted for
   * it. Null when no key for the note at `keyVersion` is held.
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

  /** An image sealed for upload. Rejects with `ImageKindError` for a file
   * that is not an image a note may hold. */
  async sealUpload(image: Blob): Promise<ImageUpload> {
    const sealed = await sealImage(
      await this.images,
      new Uint8Array(await image.arrayBuffer()),
    );
    if (!sealed) throw new ImageKindError();
    return {
      body: new Blob([sealed.bytes], { type: "application/octet-stream" }),
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Attachment-Address": sealed.address,
      },
      key: sealed.key,
    };
  }

  /** Keeps what opens the image the server has just named `ref`. */
  keepImageKey(ref: string, key: ImageKey | null): void {
    if (key) this.imageKeys.set(ref, key);
  }

  /** `to` is the same sealed image as `from`, stored again for a note's
   * owner: the same key opens it. */
  sameImage(from: string, to: string): void {
    const key = this.imageKeys.get(from);
    if (key) this.imageKeys.set(to, key);
  }

  /** The image `ref` names, from its sealed bytes. Rejects when this device
   * has no key for it, or it does not open as the image its note says. */
  async openDownload(ref: string, sealed: Blob): Promise<Blob> {
    const key = this.imageKeys.get(ref);
    const image = key
      ? await openImage(key, new Uint8Array(await sealed.arrayBuffer()))
      : null;
    if (!key || !image) throw new Error("The image could not be opened");
    return new Blob([image], { type: key.type });
  }

  /** Keeps a note's key, and says so when it is not the one held before. */
  private hold(id: string, held: HeldNoteKey): void {
    const before = this.noteKeys.get(id);
    this.noteKeys.set(id, held);
    if (before && before.key.version !== held.key.version) {
      const next = new Map(this.replaced.value);
      next.set(id, held.key.version);
      this.replaced.value = next;
    }
  }

  /** A held note key wrapped under the reminder key: the copy a calendar
   * feed opens the note with. */
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
   * The copy of a note's key for this account's calendar feeds, to store
   * with a note that has a reminder and none yet.
   */
  async feedKey(
    id: string,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<string> {
    return this.wrappedForFeed(id, await this.keyOf(id, fetch));
  }

  /** The note as its reader sees it; null when its key does not open. */
  async open(sealed: SealedNote): Promise<Note | null> {
    const account = await this.account;
    // No copy of the key of their own, and one offered: taken first.
    if (sealed.key === "" && sealed.offered && offerHandler) {
      await offerHandler(this, sealed);
    }
    const known = this.noteKeys.get(sealed.id);
    const opened = await openSealedNote(
      account,
      sealed,
      // The same wrapped copy as last time, or a key just taken from an
      // offer, which the server does not hold yet: no need to unwrap. A key
      // of another version is not the note's any more.
      known &&
        known.key.version === sealed.keyVersion &&
        (known.wrapped === sealed.key || sealed.key === "")
        ? known.key
        : undefined,
    );
    if (!opened) {
      // Under a key that was replaced, and the new one not here yet: the
      // old one seals nothing more.
      if (known && known.key.version !== sealed.keyVersion) {
        this.noteKeys.delete(sealed.id);
      }
      toggleIn(this.unreadable, sealed.id, true);
      return null;
    }
    const previous = sealed.previousKeys ?? "";
    if (
      known?.key === opened.key &&
      known.wrapped === sealed.key &&
      known.previous === previous
    ) {
      // As held already: kept, with the earlier keys it has opened.
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
    for (const [ref, key] of opened.imageKeys) this.imageKeys.set(ref, key);
    toggleIn(this.unreadable, sealed.id, false);
    return opened.note;
  }

  /** Every note of a listing that opens, in order, a few at a time. */
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

  /** Whether a note of this id has been opened here. */
  holds(id: string): boolean {
    return this.noteKeys.has(id);
  }

  /** A note's key no longer applies: it was deleted, or taken away. */
  forget(id: string): void {
    this.noteKeys.delete(id);
    toggleIn(this.unreadable, id, false);
  }

  /** A new note under a new key and `id`. */
  async sealNew(id: string, note: NoteCreate): Promise<SealedNoteCreate> {
    const { sealed, key } = await sealNewNote(
      await this.account,
      id,
      note,
      this.imageKeys,
    );
    const held = { key, wrapped: sealed.key, previous: "" };
    this.hold(id, held);
    return note.reminder
      ? { ...sealed, reminderKey: await this.wrappedForFeed(id, held) }
      : sealed;
  }

  /**
   * The key of a note already on the server. `fetch` reads the note when
   * this device has not opened it yet.
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
        return held;
      }
    }
    throw new NoteKeyError(id);
  }

  /** A note's key with the ones before it, opened once and kept. */
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
   * The note under a new key, for its owner to send: what everyone on the
   * note shares sealed again as it is, the new key wrapped for this account,
   * the keys before it sealed under it, and the new key wrapped for each
   * live public link. Null when the note does not open here, and then
   * nothing is replaced. `commit` is called once the server has taken it.
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
      // A note with keys before this one that do not open is left alone:
      // replacing the key would lose what they opened.
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
        // A link whose key does not open here stops opening the note.
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
        // Under its new key the note is not due one, which the next read
        // would only say again.
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
      changes,
      this.imageKeys,
    );
    // A reminder being set: the note's key goes under the reminder key with
    // it, so a calendar feed can name the event.
    if (changes.reminder) {
      sealed.reminderKey = await this.wrappedForFeed(id, held);
    }
    // Words under the note key say which one, so the server can refuse
    // them once the note has left it.
    const shared = SEALED_SHARED_NOTE_FIELDS.some((field) => field in sealed);
    return shared ? { ...sealed, keyVersion: key.version } : sealed;
  }

  /**
   * A whole note written over one this account already holds, as an import
   * does: under the key the note has, so its versions and its document stay
   * readable.
   */
  async sealOver(id: string, note: NoteCreate): Promise<SealedNoteCreate> {
    const held = this.noteKeys.get(id);
    if (!held) return this.sealNew(id, note);
    const account = await this.account;
    const { title, content, font, images, linkPreviews, color, tags, ...rest } =
      note;
    const shared = await sealSharedFields(
      held.key,
      id,
      { title, content, font, images, linkPreviews },
      this.imageKeys,
    );
    const personal = await sealPersonalFields(account, id, { color, tags });
    return {
      ...rest,
      id,
      key: held.wrapped,
      keyVersion: held.key.version,
      ...shared,
      ...personal,
      ...(note.reminder && {
        reminderKey: await this.wrappedForFeed(id, held),
      }),
    } as SealedNoteCreate;
  }

  /** A version to add to a note's history. */
  async sealVersion(
    noteId: string,
    version: Pick<NoteVersion, "title" | "content"> & { timestamp?: string },
    fetch: () => Promise<SealedNote | null>,
  ): Promise<SealedNoteVersionCreateRequest> {
    const { key } = await this.keyOf(noteId, fetch);
    const id = ulid();
    return {
      id,
      ...(await sealVersion(key, id, version)),
      ...(version.timestamp !== undefined && { timestamp: version.timestamp }),
    };
  }

  /** The versions that open, newest first as they came: each with the key
   * it was written under, the note's or one before it. */
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
      if (opened) out.push(opened);
    }
    return out;
  }

  /**
   * The keys a note's shared document is read and written with: its edits,
   * snapshots and cursors are sealed under the note's key, and what was
   * written before the key was replaced opens with the one before. Rejects
   * with `NoteKeyError` for a note whose key this device does not hold.
   */
  async documentKey(
    noteId: string,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<NoteKeyRing | null> {
    return this.ringOf(noteId, fetch);
  }

  /**
   * What publishing a note takes: a new link key, which goes into the link's
   * address and nowhere else, and what the server is sent. A live link gets
   * the note key wrapped by the link key; a snapshot gets a copy of the note
   * as it is now, sealed under a key derived from the link key. Either way
   * the link key is also sealed for this account, so its owner can copy the
   * address again.
   */
  async publish(
    note: Pick<
      Note,
      "id" | "title" | "content" | "font" | "images" | "linkPreviews"
    >,
    mode: PublicLinkMode,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<{
    linkKey: string;
    fields: Pick<
      PublicLinkCreateRequest,
      "sealedLinkKey" | "wrappedKey" | "snapshot"
    >;
  } | null> {
    const account = await this.account;
    const linkKey = newLinkKey();
    const sealedLinkKey = await sealPref(account, `link/${note.id}`, linkKey);
    if (mode === "live") {
      const held = await this.keyOf(note.id, fetch);
      const raw = await unwrapNoteKey(
        account,
        note.id,
        held.key.version,
        held.wrapped,
      );
      if (!raw) throw new NoteKeyError(note.id);
      try {
        return {
          linkKey,
          fields: {
            sealedLinkKey,
            wrappedKey: await wrapForLink(
              linkKey,
              note.id,
              held.key.version,
              raw,
            ),
          },
        };
      } finally {
        wipe(raw);
      }
    }
    const key = await snapshotKey(linkKey);
    if (!key) return null;
    const sealed = await sealSharedFields(
      key,
      note.id,
      {
        title: note.title,
        content: note.content,
        font: note.font,
        images: note.images,
        linkPreviews: note.linkPreviews,
      },
      this.imageKeys,
    );
    return {
      linkKey,
      fields: {
        sealedLinkKey,
        snapshot: {
          title: sealed.title ?? "",
          content: sealed.content ?? "",
          font: sealed.font ?? "",
          images: sealed.images ?? "",
          linkPreviews: sealed.linkPreviews ?? "",
          refs: [...(sealed.imageRefs ?? []), ...(sealed.previewRefs ?? [])],
        },
      },
    };
  }

  /** A link's key, from the copy sealed for its owner; null when it does
   * not open. */
  async openLinkKey(noteId: string, sealed: string): Promise<string | null> {
    const opened = await openPref(await this.account, `link/${noteId}`, sealed);
    return typeof opened === "string" ? opened : null;
  }

  /**
   * A new token that carries keys: its secret, which stays on this side,
   * and what the server is sent of it. The notes key and the personal key
   * (or, for a calendar feed, the reminder key alone) are derived from the
   * account key as bytes for the one wrap and wiped; the account key itself
   * is never among them, so a token opens no private key and accepts no
   * invitation.
   */
  async newToken(
    prefix: string,
    carries: "notes" | "reminders" = "notes",
  ): Promise<{
    secret: string;
    fields: { tokenHash: string; prefix: string; wrappedKeys: string };
  } | null> {
    const secret = newTokenSecret(prefix);
    if (carries === "reminders") {
      // A calendar feed's address: the reminder key and nothing else.
      const reminders = await deriveBytes(
        this.keys.accountKey,
        "account/reminder",
      );
      try {
        return {
          secret,
          fields: {
            tokenHash: await tokenHashOf(secret),
            prefix: secret.slice(0, prefix.length + 6),
            wrappedKeys: await wrapFeedKey(secret, {
              version: this.keys.version,
              reminders,
            }),
          },
        };
      } finally {
        wipe(reminders);
      }
    }
    const notes = await deriveBytes(this.keys.accountKey, "account/notes");
    const personal = await deriveBytes(
      this.keys.accountKey,
      "account/personal",
    );
    try {
      return {
        secret,
        fields: {
          tokenHash: await tokenHashOf(secret),
          // The prefix and six characters, which is what a list shows.
          prefix: secret.slice(0, prefix.length + 6),
          wrappedKeys: await wrapTokenKeys(secret, {
            version: this.keys.version,
            notes,
            personal,
          }),
        },
      };
    } finally {
      wipe(notes);
      wipe(personal);
    }
  }

  /** A comment's text, sealed under its note's key and bound to `id`. */
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
   * The comments that open, as they came: each with the key it was written
   * under, the note's or one before it.
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

  /** Someone's public keys as this account remembers them, sealed under its
   * own key and bound to whose they are. */
  async sealSeenKeys(peerId: string, keys: SeenKeys): Promise<string> {
    return sealPref(await this.account, `seen/${peerId}`, keys);
  }

  /** The remembered keys that open, by account. One that does not open, or
   * is not a pair of keys, is left out, and its account is met as new. */
  async openSeenKeys(
    sealed: Record<string, string>,
  ): Promise<Map<string, SeenKeys>> {
    const account = await this.account;
    const out = new Map<string, SeenKeys>();
    for (const [peerId, value] of Object.entries(sealed)) {
      const opened = (await openPref(account, `seen/${peerId}`, value)) as
        | Partial<SeenKeys>
        | undefined;
      if (
        opened &&
        typeof opened === "object" &&
        typeof opened.exchange === "string" &&
        typeof opened.signing === "string" &&
        typeof opened.version === "number"
      ) {
        out.set(peerId, {
          version: opened.version,
          exchange: opened.exchange,
          signing: opened.signing,
        });
      }
    }
    return out;
  }

  /** The preferences to send, each sealed; `null` removes one and stays. */
  async sealPrefs(
    prefs: Record<string, unknown>,
  ): Promise<Record<string, string | null>> {
    const account = await this.account;
    const out: Record<string, string | null> = {};
    for (const [name, value] of Object.entries(prefs)) {
      out[name] =
        value === null || value === undefined
          ? null
          : await sealPref(account, name, value);
    }
    return out;
  }

  /** The preferences that open; one that does not is left out. */
  async openPrefs(
    sealed: SealedAccountPrefs,
  ): Promise<Record<string, unknown>> {
    const account = await this.account;
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(sealed)) {
      const opened = await openPref(account, name, value);
      if (opened !== undefined) out[name] = opened;
    }
    return out;
  }
}

/** What the storage layer seals and opens with: `Sealer`, as its callers
 * see it. */
export type NoteSealing = Pick<Sealer, keyof Sealer>;

/** What takes a key offered with a note; see `storage/shareKeys.ts`. */
type OfferHandler = (sealing: NoteSealing, sealed: SealedNote) => Promise<void>;

let offerHandler: OfferHandler | null = null;

/**
 * Set by `storage/shareKeys.ts`, which knows how to ask the server for the
 * signer's key: the sealing itself must not reach for a request.
 */
export function setOfferHandler(handler: OfferHandler | null): void {
  offerHandler = handler;
}

const forTests = signal<NoteSealing | null>(null);

/**
 * Puts another sealing in place of the account's, for tests of what sits
 * above storage (`test/plainSealing.ts`). Null takes it away again.
 */
export function setSealingForTests(sealing: NoteSealing | null): void {
  forTests.value = sealing;
}

/** The sealing of the account that is unlocked now; null while locked, in
 * open mode, and signed out. */
export const sealer = computed<NoteSealing | null>(
  () =>
    forTests.value ??
    (storageKeys.value ? new Sealer(storageKeys.value) : null),
);
