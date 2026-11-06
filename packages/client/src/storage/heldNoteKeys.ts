import {
  type AccountSealKeys,
  type NoteSealKey,
  noteSealKey,
  openNoteKey,
  openPreviousKeys,
  type SealedNote,
  unwrapNoteKey,
  wipe,
  wrapForReminders,
} from "@manifesto/shared";
import { type Signal, signal } from "@preact/signals";
import { accountSubkey } from "#/utils/keyMaterial.ts";
import type { StorageKeys } from "./storageKeys.ts";

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
export interface HeldNoteKey {
  key: NoteSealKey;
  wrapped: string;
  /** The keys before this one, as the note carries them sealed. */
  previous: string;
  /** Those keys opened, the first time that code reads something under one. */
  older?: Promise<ReadonlyMap<number, NoteSealKey>>;
}

/**
 * The key of a note, and its previous keys. Together, they open all data
 * written next to the note, whenever it was written.
 */
export interface NoteKeyRing {
  key: NoteSealKey;
  older: ReadonlyMap<number, NoteSealKey>;
}

export function ringKey(
  ring: NoteKeyRing,
  version: number,
): NoteSealKey | null {
  return version === ring.key.version
    ? ring.key
    : (ring.older.get(version) ?? null);
}

/** Puts `id` in the set that `held` has, or removes it. */
export function toggleIn(
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
 * The first layer of the `Sealer` (`sealing.ts`): the keys of one unlocked
 * account, and the key of each note that it opened. Thus, a change to a note
 * is sealed without a new unwrap of its key. Nobody can read the keys
 * themselves out of it.
 */
export class HeldNoteKeys {
  protected readonly account: Promise<AccountSealKeys>;
  /** Wraps the key of each note that has a reminder, for a calendar feed. */
  protected readonly reminders: Promise<CryptoKey>;
  protected readonly noteKeys = new Map<string, HeldNoteKey>();
  protected readonly keys: StorageKeys;
  /** The format in which each note opened here is stored. */
  protected readonly formats = new Map<string, number>();
  /**
   * The key version of each note whose key was replaced while it was open here.
   * Thus, all that has the old key (a live document) starts again.
   */
  readonly replaced = signal<ReadonlyMap<string, number>>(new Map());

  constructor(keys: StorageKeys) {
    this.keys = keys;
    this.account = (async () => ({
      userId: keys.userId,
      version: keys.version,
      notes: await accountSubkey(keys.accountKey, "notes"),
      personal: await accountSubkey(keys.accountKey, "personal"),
    }))();
    this.reminders = accountSubkey(keys.accountKey, "reminder");
  }

  /** Keeps the key of a note, and tells when it is not the key held before. */
  protected hold(id: string, held: HeldNoteKey): void {
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
  protected async wrappedForFeed(
    id: string,
    held: HeldNoteKey,
  ): Promise<string> {
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

  /** If a note with this id was opened here. */
  holds(id: string): boolean {
    return this.noteKeys.has(id);
  }

  /**
   * The key of a note that is already on the server. `fetch` reads the note
   * when this device did not open it yet.
   */
  protected async keyOf(
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
  protected async ringOf(
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
}
