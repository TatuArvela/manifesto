import {
  changesWords,
  currentNoteFormat,
  type ImageKey,
  isNewerNoteFormat,
  type Note,
  type NoteCreate,
  type NoteUpdate,
  openSealedNote,
  SEALED_SHARED_NOTE_FIELDS,
  type SealedNote,
  type SealedNoteCreate,
  type SealedNoteUpdate,
  sealNewNote,
  sealNoteUpdate,
  sealPersonalFields,
  sealSharedFields,
  withEveryWord,
} from "@manifesto/shared";
import { signal } from "@preact/signals";
import { accountImageKeys } from "#/utils/keyMaterial.ts";
import { HeldNoteKeys, NoteKeyError, toggleIn } from "./heldNoteKeys.ts";
import { ImageKeyRing, type ImageUpload } from "./imageKeyRing.ts";
import type { StorageKeys } from "./storageKeys.ts";

/** How many notes of a listing are in their open at each moment. */
const OPENED_AT_ONCE = 8;

/**
 * The second layer of the `Sealer` (`sealing.ts`): the notes themselves and
 * their images, sealed under the held keys. It also keeps the marks of each
 * note that did not open.
 */
export abstract class NoteSealer extends HeldNoteKeys {
  /** What opens each image that this device saw, by its reference. */
  protected readonly images: ImageKeyRing;
  /**
   * If the images of a note must be made the property of its owner before it
   * names them (`POST /api/v1/attachments/claim`).
   */
  readonly claimsImages: boolean = true;
  /** If the key of a shared note is wrapped for the persons on it. */
  readonly handsKeysOn: boolean = true;
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
   * If a full listing was opened. Thus, the key of each note of the account is
   * available. An import needs that before it seals, because a note that is
   * already there is written over under its current key.
   */
  complete = false;

  constructor(keys: StorageKeys) {
    super(keys);
    this.images = new ImageKeyRing(accountImageKeys(keys.accountKey));
  }

  /**
   * Takes the key that `sealed` offers to this account, when there is a way to
   * take it (`setOfferHandler`).
   */
  protected abstract takeOffer(sealed: SealedNote): Promise<void>;

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
      this.noteKeys.get(sealed.id)?.key.version !== sealed.offered.keyVersion
    ) {
      await this.takeOffer(sealed);
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
}
