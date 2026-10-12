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
  openSealedNote,
  openSharedFields,
  openVersion,
  type PublicLinkCreateRequest,
  type PublicLinkMode,
  type SealedAccountPrefs,
  type SealedNote,
  type SealedNoteCreate,
  type SealedNoteUpdate,
  type SealedNoteVersion,
  type SealedNoteVersionCreateRequest,
  sealComment,
  sealImage,
  sealNewNote,
  sealNoteUpdate,
  sealPersonalFields,
  sealPref,
  sealSharedFields,
  sealVersion,
  snapshotKey,
  tokenHashOf,
  unwrapNoteKey,
  verifyOfferedKey,
  wipe,
  wrapForLink,
  wrapNoteKey,
  wrapTokenKeys,
} from "@manifesto/shared";
import { computed, signal } from "@preact/signals";
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
}

/**
 * One unlocked account's sealing. It remembers the key of every note it has
 * opened, so a change to a note is sealed without unwrapping its key again;
 * the keys themselves cannot be read out of it.
 */
export class Sealer {
  private readonly account: Promise<AccountSealKeys>;
  private readonly images: Promise<ImageKeySource>;
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
  /** Notes that arrived and did not open, by id. */
  readonly unreadable = signal<ReadonlySet<string>>(new Set());
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
  }

  /**
   * The account's two private keys, opened with the account key from what
   * the server holds wrapped (`load`). Null when they could not be read or
   * do not open; asked again the next time, then.
   */
  private async ownPrivateKeys(load: () => Promise<AccountKeys | null>) {
    this.privateKeys ??= (async () => {
      const held = await load();
      if (!held) return null;
      const { accountKey, userId } = this.keys;
      const exchange = await openPrivateKey(
        accountKey,
        userId,
        held,
        "exchange",
      );
      const signing = await openPrivateKey(accountKey, userId, held, "signing");
      return exchange && signing ? { exchange, signing } : null;
    })();
    const opened = await this.privateKeys;
    if (!opened) this.privateKeys = null;
    return opened;
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
   * check or does not open.
   */
  async adoptOffered(
    noteId: string,
    offered: OfferedKey,
    signerKey: string,
    load: () => Promise<AccountKeys | null>,
  ): Promise<HeldKeyRequest | null> {
    const context = { noteId, recipientId: this.keys.userId };
    if (!(await verifyOfferedKey(context, offered, signerKey))) return null;
    const own = await this.ownPrivateKeys(load);
    if (!own) return null;
    const raw = await openOfferedKey(context, offered, own.exchange);
    if (!raw) return null;
    try {
      const wrapped = await wrapNoteKey(
        await this.account,
        noteId,
        offered.keyVersion,
        raw,
      );
      this.noteKeys.set(noteId, {
        key: await noteSealKey(raw, offered.keyVersion),
        wrapped,
      });
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

  private markUnreadable(id: string, unreadable: boolean): void {
    const held = this.unreadable.peek();
    if (held.has(id) === unreadable) return;
    const next = new Set(held);
    if (unreadable) next.add(id);
    else next.delete(id);
    this.unreadable.value = next;
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
      // offer, which the server does not hold yet: no need to unwrap.
      known && (known.wrapped === sealed.key || sealed.key === "")
        ? known.key
        : undefined,
    );
    if (!opened) {
      this.markUnreadable(sealed.id, true);
      return null;
    }
    if (sealed.key !== "") {
      this.noteKeys.set(sealed.id, { key: opened.key, wrapped: sealed.key });
    }
    for (const [ref, key] of opened.imageKeys) this.imageKeys.set(ref, key);
    this.markUnreadable(sealed.id, false);
    return opened.note;
  }

  /** Every note of a listing that opens, in order. */
  async openAll(sealed: SealedNote[]): Promise<Note[]> {
    const out: Note[] = [];
    for (const note of sealed) {
      const opened = await this.open(note);
      if (opened) out.push(opened);
    }
    return out;
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
  }

  /** A new note under a new key and `id`. */
  async sealNew(id: string, note: NoteCreate): Promise<SealedNoteCreate> {
    const { sealed, key } = await sealNewNote(
      await this.account,
      id,
      note,
      this.imageKeys,
    );
    this.noteKeys.set(id, { key, wrapped: sealed.key });
    return sealed;
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
        const held = { key, wrapped: sealed.key };
        this.noteKeys.set(id, held);
        return held;
      }
    }
    throw new NoteKeyError(id);
  }

  /** The changes to a note, with the words among them sealed. */
  async sealUpdate(
    id: string,
    changes: NoteUpdate,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<SealedNoteUpdate> {
    const { key } = await this.keyOf(id, fetch);
    return sealNoteUpdate(await this.account, key, id, changes, this.imageKeys);
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

  /** The versions that open with the note's current key, newest first as
   * they came. One under an earlier key is left out. */
  async openVersions(
    noteId: string,
    sealed: SealedNoteVersion[],
    fetch: () => Promise<SealedNote | null>,
  ): Promise<NoteVersion[]> {
    if (sealed.length === 0) return [];
    const { key } = await this.keyOf(noteId, fetch);
    const out: NoteVersion[] = [];
    for (const version of sealed) {
      const opened = await openVersion(key, version);
      if (opened) out.push(opened);
    }
    return out;
  }

  /**
   * The key a note's shared document is sealed with: its edits, snapshots
   * and cursors. Rejects with `NoteKeyError` for a note whose key this
   * device does not hold.
   */
  async documentKey(
    noteId: string,
    fetch: () => Promise<SealedNote | null>,
  ): Promise<NoteSealKey | null> {
    return (await this.keyOf(noteId, fetch)).key;
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
   * are derived from the account key as bytes for the one wrap and wiped;
   * the account key itself is never among them, so a token opens no private
   * key and accepts no invitation.
   */
  async newToken(prefix: string): Promise<{
    secret: string;
    fields: { tokenHash: string; prefix: string; wrappedKeys: string };
  } | null> {
    const secret = newTokenSecret(prefix);
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
   * The comments that open with the note's current key, as they came. One
   * under an earlier key, or that does not open, is left out.
   */
  async openComments(
    noteId: string,
    sealed: NoteComment[],
    fetch: () => Promise<SealedNote | null>,
  ): Promise<NoteComment[]> {
    if (sealed.length === 0) return [];
    const { key } = await this.keyOf(noteId, fetch);
    const out: NoteComment[] = [];
    for (const comment of sealed) {
      const body = await openComment(key, comment);
      if (body !== null) out.push({ ...comment, body });
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
