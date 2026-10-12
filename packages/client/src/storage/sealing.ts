import {
  type AccountSealKeys,
  type Note,
  type NoteCreate,
  type NoteSealKey,
  type NoteUpdate,
  type NoteVersion,
  openNoteKey,
  openPref,
  openSealedNote,
  openVersion,
  type SealedAccountPrefs,
  type SealedNote,
  type SealedNoteCreate,
  type SealedNoteUpdate,
  type SealedNoteVersion,
  type SealedNoteVersionCreateRequest,
  sealNewNote,
  sealNoteUpdate,
  sealPersonalFields,
  sealPref,
  sealSharedFields,
  sealVersion,
} from "@manifesto/shared";
import { computed, signal } from "@preact/signals";
import { ulid } from "ulid";
import { accountSubkey } from "../utils/keyMaterial.js";

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
  private readonly noteKeys = new Map<string, HeldNoteKey>();
  /** Notes that arrived and did not open, by id. */
  readonly unreadable = signal<ReadonlySet<string>>(new Set());
  /**
   * Whether a whole listing has been opened, so the key of every note the
   * account holds is at hand. An import needs that before it seals: a note
   * already there is written over under the key it has.
   */
  complete = false;

  constructor(keys: StorageKeys) {
    this.account = (async () => ({
      userId: keys.userId,
      version: keys.version,
      notes: await accountSubkey(keys.accountKey, "notes"),
      personal: await accountSubkey(keys.accountKey, "personal"),
    }))();
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
    const known = this.noteKeys.get(sealed.id);
    const opened = await openSealedNote(
      account,
      sealed,
      // The same wrapped copy as last time: no need to unwrap it again.
      known?.wrapped === sealed.key ? known.key : undefined,
    );
    if (!opened) {
      this.markUnreadable(sealed.id, true);
      return null;
    }
    this.noteKeys.set(sealed.id, { key: opened.key, wrapped: sealed.key });
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
    const { sealed, key } = await sealNewNote(await this.account, id, note);
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
    return sealNoteUpdate(await this.account, key, id, changes);
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
    const shared = await sealSharedFields(held.key, id, {
      title,
      content,
      font,
      images,
      linkPreviews,
    });
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
