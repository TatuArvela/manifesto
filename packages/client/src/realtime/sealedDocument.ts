import {
  associatedData,
  type NoteSealKey,
  seal,
  sealBytes,
  unsealBytes,
  unsealText,
  utf8,
} from "@manifesto/shared";
import {
  type Awareness,
  Awareness as AwarenessOf,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";

/**
 * The shared document of a note, sealed
 * (`docs/specification/features/encryption.md`, "Collaboration").
 *
 * There are two documents. The **inner** document is the note as the editor
 * binds to it, readable, and it never goes out of the browser. The **outer**
 * document is what the server syncs, merges and stores: a list of entries, each
 * an edit to the inner document or a snapshot of all of it, sealed under a key
 * derived from the note key. The server relays and keeps ciphertext. The
 * clients do the merge, which Yjs does in the same way in all places.
 *
 * Presence uses the same bridge. The awareness of the editor is local, and each
 * cursor goes across sealed. The server still adds the authenticated account to
 * each state, and still refuses a state for a client id that a different
 * connection has. For neither does it have to read anything.
 */

/** The list of sealed entries of the outer document. */
const LOG = "log";

const EDIT = 0;
const SNAPSHOT = 1;
/** The kind, then the version of the note key as four bytes. */
const HEADER_BYTES = 5;

/** How many edits collect before a client folds them into a snapshot. */
export const COMPACT_AFTER = 200;
/** How many snapshots are kept. Thus, a client can skip a faulty one. */
const SNAPSHOTS_KEPT = 3;

/** Marks what this bridge wrote. Thus, it does not answer itself. */
const FROM_OUTER = Symbol("from the sealed log");
const TO_OUTER = Symbol("to the sealed log");

function entryOf(
  kind: number,
  version: number,
  sealed: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const entry = new Uint8Array(HEADER_BYTES + sealed.length);
  entry[0] = kind;
  new DataView(entry.buffer).setUint32(1, version);
  entry.set(sealed, HEADER_BYTES);
  return entry;
}

function kindOf(entry: Uint8Array): number {
  return entry[0] ?? -1;
}

function versionOf(entry: Uint8Array): number {
  return new DataView(
    entry.buffer,
    entry.byteOffset,
    entry.byteLength,
  ).getUint32(1);
}

export interface SealedDocument {
  /** Resolves when each entry that arrived is in the inner document. */
  settled(): Promise<void>;
  /** Folds the edits so far into a snapshot, if sufficient edits collected. */
  compact(force?: boolean): Promise<void>;
  /** Entries that arrived and did not open: a different key, or damage. */
  unreadable(): number;
  /**
   * Stops to carry new data across. Resolves when the edits already made to the
   * inner document are in the outer document. The holder of the outer document
   * must wait for that before it closes it. The seal takes a short time, and
   * the last keystrokes before a note closes are still on their way.
   */
  destroy(): Promise<void>;
}

/**
 * Joins `inner` to `outer`. An edit made to `inner` is sealed and appended to
 * the log of `outer`. An entry that arrives in the log is opened and applied to
 * `inner`. Both directions use a queue, because the seal takes a short time,
 * and an edit must not apply on top of an edit that is still in its open. Yjs
 * merges updates in any order. Thus, the queue is for `settled`, not for
 * correctness.
 */
export function joinSealedDocument(options: {
  noteId: string;
  key: NoteSealKey;
  /**
   * The previous keys of the note, by version. The code reads what they sealed,
   * and writes nothing new under one.
   */
  older?: ReadonlyMap<number, NoteSealKey> | undefined;
  inner: Y.Doc;
  outer: Y.Doc;
  /**
   * Gets the number of entries that did not open, each time another one does
   * not.
   */
  onUnreadable?: ((count: number) => void) | undefined;
}): SealedDocument {
  const { noteId, key, older, inner, outer, onUnreadable } = options;
  const log = outer.getArray<Uint8Array>(LOG);
  const data = (kind: number, version = key.version) =>
    associatedData({
      id: noteId,
      field: kind === SNAPSHOT ? "document/snapshot" : "document/edit",
      version,
    });
  let queue: Promise<void> = Promise.resolve();
  let unreadable = 0;
  let destroyed = false;
  /**
   * If this device has the key of an entry, and thus read it. An entry under a
   * key that it does not have yet (a replacement that it did not get) is in no
   * snapshot that it writes.
   */
  const readable = (entry: Uint8Array) => {
    if (entry.length <= HEADER_BYTES) return false;
    const version = versionOf(entry);
    return version === key.version || (older?.has(version) ?? false);
  };
  const passOver = () => {
    unreadable++;
    onUnreadable?.(unreadable);
  };

  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch((err) => {
      console.warn("Failed to carry an edit across the sealed document:", err);
    });
  };

  async function open(entry: Uint8Array): Promise<void> {
    if (destroyed || entry.length <= HEADER_BYTES) return;
    const kind = kindOf(entry);
    const version = versionOf(entry);
    // Under a key for which this device does not have the document: not
    // changed.
    const under = version === key.version ? key : older?.get(version);
    const update =
      under && (kind === EDIT || kind === SNAPSHOT)
        ? await unsealBytes(
            await under.edits(),
            entry.slice(HEADER_BYTES),
            data(kind, version),
          )
        : null;
    if (!update) {
      passOver();
      return;
    }
    try {
      Y.applyUpdate(inner, update, FROM_OUTER);
    } catch (err) {
      // What opened was not an update: a faulty writer. The code skips its
      // entry, as an entry that did not open.
      passOver();
      console.warn("A sealed edit did not apply:", err);
    }
  }

  async function append(kind: number, update: Uint8Array): Promise<void> {
    const sealed = await sealBytes(
      await key.edits(),
      new Uint8Array(update),
      data(kind),
    );
    // Written also after `destroy`, which waits for it. The edit was made while
    // the document was open, and is in no other place.
    outer.transact(() => {
      log.push([entryOf(kind, key.version, sealed)]);
    }, TO_OUTER);
  }

  // The data that is already there (from the offline copy of this browser),
  // then the data that arrives.
  for (const entry of log.toArray()) enqueue(() => open(entry));
  const onLog = (event: Y.YArrayEvent<Uint8Array>, tx: Y.Transaction) => {
    if (tx.origin === TO_OUTER) return;
    for (const change of event.changes.delta) {
      if (!Array.isArray(change.insert)) continue;
      for (const entry of change.insert as Uint8Array[]) {
        enqueue(() => open(entry));
      }
    }
  };
  log.observe(onLog);

  const onInner = (update: Uint8Array, origin: unknown) => {
    if (origin === FROM_OUTER) return;
    enqueue(() => append(EDIT, update));
  };
  inner.on("update", onInner);

  async function compact(force = false): Promise<void> {
    await queue;
    if (destroyed) return;
    const edits = log.toArray().filter((e) => kindOf(e) === EDIT).length;
    if (!force && edits < COMPACT_AFTER) return;
    // All of the log was applied (the queue is empty). Thus, the current inner
    // document covers each entry that this device can read. An entry under a
    // key that it does not have is in none of its snapshots, and is never
    // removed here. The device that has that key compacts it.
    const sealed = await sealBytes(
      await key.edits(),
      new Uint8Array(Y.encodeStateAsUpdate(inner)),
      data(SNAPSHOT),
    );
    if (destroyed) return;
    outer.transact(() => {
      const entries = log.toArray();
      // Only the snapshots that this device can read. The snapshots of a
      // different key concern the holder of that key.
      const snapshots = entries.flatMap((entry, index) =>
        kindOf(entry) === SNAPSHOT && readable(entry) ? [index] : [],
      );
      // The snapshot before this one. The edits that it covers waited for the
      // snapshot after it, which is this one. Thus, they can go. The edits
      // after it stay. Thus, a client can skip this snapshot if it is faulty.
      const previous = snapshots.at(-1) ?? -1;
      const stale = new Set<number>();
      entries.forEach((entry, index) => {
        if (kindOf(entry) === EDIT && index < previous && readable(entry)) {
          stale.add(index);
        }
      });
      // With the new one, the code keeps the last three that this device can
      // read.
      for (const index of snapshots.slice(0, 1 - SNAPSHOTS_KEPT)) {
        stale.add(index);
      }
      for (const index of [...stale].sort((a, b) => b - a)) {
        log.delete(index, 1);
      }
      log.push([entryOf(SNAPSHOT, key.version, sealed)]);
    }, TO_OUTER);
  }

  return {
    settled: async () => {
      // An entry that arrives while the queue empties joins it.
      let seen: Promise<void>;
      do {
        seen = queue;
        await seen;
      } while (seen !== queue);
    },
    compact,
    unreadable: () => unreadable,
    destroy: () => {
      destroyed = true;
      log.unobserve(onLog);
      inner.off("update", onInner);
      return queue;
    },
  };
}

/** The label at a cursor: the account that the server authenticated. */
interface Stamp {
  id?: unknown;
  name?: unknown;
  color?: unknown;
}

/**
 * Joins the awareness of the editor (`inner`) to the awareness that goes across
 * the wire (`outer`). The cursor of this tab goes out sealed, as `{ sealed }`.
 * A state that arrives is opened, and shown under the `user` that the server
 * added to it. The code ignores the name inside. Returns what stops it.
 */
export function joinSealedAwareness(options: {
  noteId: string;
  key: NoteSealKey;
  inner: Awareness;
  outer: Awareness;
}): () => void {
  const { noteId, key, inner, outer } = options;
  const data = associatedData({
    id: noteId,
    field: "document/presence",
    version: key.version,
  });
  /**
   * One awareness for each remote client, with which to make its updates. An
   * update applies only with a clock later than the last.
   */
  const remotes = new Map<number, { doc: Y.Doc; awareness: Awareness }>();
  /** The value to which the sealed state of each remote client last opened. */
  const opened = new Map<number, { sealed: string; state: object | null }>();
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;

  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch((err) => {
      console.warn("Failed to carry a cursor across:", err);
    });
  };

  function forget(clientId: number): void {
    const remote = remotes.get(clientId);
    remote?.awareness.destroy();
    remote?.doc.destroy();
    remotes.delete(clientId);
    opened.delete(clientId);
    removeAwarenessStates(inner, [clientId], FROM_OUTER);
  }

  async function show(clientId: number): Promise<void> {
    if (stopped) return;
    const state = outer.getStates().get(clientId) as
      | { sealed?: unknown; user?: Stamp }
      | undefined;
    if (!state || typeof state.sealed !== "string") {
      forget(clientId);
      return;
    }
    let held = opened.get(clientId);
    if (held?.sealed !== state.sealed) {
      const text = await unsealText(await key.presence(), state.sealed, data);
      let parsed: unknown = null;
      try {
        parsed = text === null ? null : JSON.parse(text);
      } catch {
        parsed = null;
      }
      held = {
        sealed: state.sealed,
        state:
          typeof parsed === "object" && parsed !== null
            ? (parsed as object)
            : null,
      };
      opened.set(clientId, held);
    }
    if (stopped || !held.state) return;
    let remote = remotes.get(clientId);
    if (!remote) {
      const doc = new Y.Doc();
      doc.clientID = clientId;
      remote = { doc, awareness: new AwarenessOf(doc) };
      remotes.set(clientId, remote);
    }
    // The name and color come from the server, never from the sender.
    remote.awareness.setLocalState({ ...held.state, user: state.user ?? {} });
    applyAwarenessUpdate(
      inner,
      encodeAwarenessUpdate(remote.awareness, [clientId]),
      FROM_OUTER,
    );
  }

  const onOuter = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => {
    for (const clientId of removed) {
      if (clientId !== outer.clientID) enqueue(async () => forget(clientId));
    }
    for (const clientId of [...added, ...updated]) {
      if (clientId !== outer.clientID) enqueue(() => show(clientId));
    }
  };
  // `update`, not `change`. A peer that did not move still renews its state,
  // and the awareness of the editor drops a state that it did not hear
  // recently.
  outer.on("update", onOuter);

  const publish = () => {
    const local = inner.getLocalState();
    enqueue(async () => {
      if (stopped) return;
      if (local === null) {
        outer.setLocalState(null);
        return;
      }
      const { user: _user, ...own } = local as Record<string, unknown>;
      const sealed = await seal(
        await key.presence(),
        utf8(JSON.stringify(own)),
        data,
      );
      // Stopped during the seal: the cursor left, and is not put back.
      if (stopped) return;
      outer.setLocalState({ sealed });
    });
  };
  const onInner = (_change: unknown, origin: unknown) => {
    if (origin !== FROM_OUTER) publish();
  };
  inner.on("change", onInner);
  publish();
  for (const clientId of outer.getStates().keys()) {
    if (clientId !== outer.clientID) enqueue(() => show(clientId));
  }

  return () => {
    stopped = true;
    outer.off("update", onOuter);
    inner.off("change", onInner);
    for (const clientId of [...remotes.keys()]) forget(clientId);
  };
}
