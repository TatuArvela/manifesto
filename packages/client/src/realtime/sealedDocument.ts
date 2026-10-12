import {
  associatedData,
  fromUtf8,
  type NoteSealKey,
  seal,
  sealBytes,
  unseal,
  unsealBytes,
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
 * A note's shared document, sealed
 * (`docs/specification/features/encryption.md`, "Collaboration").
 *
 * There are two documents. The **inner** one is the note as the editor binds
 * to it, readable, and it never leaves the browser. The **outer** one is what
 * the server syncs, merges and stores: a list of entries, each an edit to the
 * inner document or a snapshot of all of it, sealed under a key derived from
 * the note key. The server relays and keeps ciphertext; the clients do the
 * merging, which Yjs does the same way wherever it runs.
 *
 * Presence is bridged the same way: the editor's awareness is local, and
 * what crosses is each cursor sealed. The server still stamps every state
 * with the account it authenticated and still refuses a state for a client
 * id another connection holds, neither of which needs it to read anything.
 */

/** The outer document's list of sealed entries. */
const LOG = "log";

const EDIT = 0;
const SNAPSHOT = 1;
/** Kind, then the note key's version as four bytes. */
const HEADER_BYTES = 5;

/** How many edits gather before a client folds them into a snapshot. */
export const COMPACT_AFTER = 200;
/** How many snapshots are kept, so a faulty one can be passed over. */
const SNAPSHOTS_KEPT = 3;

/** Marks what this bridge wrote, so it does not answer itself. */
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

export interface SealedDocument {
  /** Resolves once every entry that has arrived is in the inner document. */
  settled(): Promise<void>;
  /** Folds the edits so far into a snapshot, if enough have gathered. */
  compact(force?: boolean): Promise<void>;
  /** Entries that arrived and did not open: another key, or damage. */
  unreadable(): number;
  /**
   * Stops carrying anything new across. Resolves once the edits already
   * made to the inner document are in the outer one, which whoever holds
   * that has to wait for before it is closed: sealing takes a moment, and
   * the last keystrokes before a note is closed are still on their way.
   */
  destroy(): Promise<void>;
}

/**
 * Joins `inner` to `outer`: an edit made to `inner` is sealed and appended to
 * `outer`'s log, and an entry that arrives in the log is opened and applied
 * to `inner`. Both directions are queued, since sealing takes a moment and an
 * edit must not be applied on top of one still being opened; Yjs merges
 * updates in any order, so the queue is for `settled`, not for correctness.
 */
export function joinSealedDocument(options: {
  noteId: string;
  key: NoteSealKey;
  /** The keys the note was under before, by version: what they sealed is
   * read, and nothing new is written under one. */
  older?: ReadonlyMap<number, NoteSealKey> | undefined;
  inner: Y.Doc;
  outer: Y.Doc;
}): SealedDocument {
  const { noteId, key, older, inner, outer } = options;
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

  const enqueue = (work: () => Promise<void>) => {
    queue = queue.then(work).catch((err) => {
      console.warn("Failed to carry an edit across the sealed document:", err);
    });
  };

  async function open(entry: Uint8Array): Promise<void> {
    if (destroyed || entry.length <= HEADER_BYTES) return;
    const kind = kindOf(entry);
    const version = new DataView(
      entry.buffer,
      entry.byteOffset,
      entry.byteLength,
    ).getUint32(1);
    // Under a key this device does not hold the document by: left alone.
    const under = version === key.version ? key : older?.get(version);
    const update =
      under && (kind === EDIT || kind === SNAPSHOT)
        ? await unsealBytes(
            under.edits,
            entry.slice(HEADER_BYTES),
            data(kind, version),
          )
        : null;
    if (!update) {
      unreadable++;
      return;
    }
    try {
      Y.applyUpdate(inner, update, FROM_OUTER);
    } catch (err) {
      // What opened was not an update: a faulty writer, whose entry is
      // passed over like one that did not open.
      unreadable++;
      console.warn("A sealed edit did not apply:", err);
    }
  }

  async function append(kind: number, update: Uint8Array): Promise<void> {
    const sealed = await sealBytes(
      key.edits,
      new Uint8Array(update),
      data(kind),
    );
    // Written even after `destroy`, which waits for it: the edit was made
    // while the document was open, and is nowhere else.
    outer.transact(() => {
      log.push([entryOf(kind, key.version, sealed)]);
    }, TO_OUTER);
  }

  // What is already there (from this browser's offline copy), then what
  // arrives.
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
    // Everything in the log has been applied (the queue is empty), so the
    // inner document as it stands covers every entry there is.
    const sealed = await sealBytes(
      key.edits,
      new Uint8Array(Y.encodeStateAsUpdate(inner)),
      data(SNAPSHOT),
    );
    if (destroyed) return;
    outer.transact(() => {
      const entries = log.toArray();
      const snapshots = entries
        .map((entry, index) => (kindOf(entry) === SNAPSHOT ? index : -1))
        .filter((index) => index >= 0);
      // The snapshot before this one: the edits it covers have waited for
      // the snapshot after it, which is this one, and can go. The edits
      // since stay, so that this snapshot can be passed over if it is
      // faulty.
      const previous = snapshots.at(-1) ?? -1;
      const stale = new Set<number>();
      entries.forEach((entry, index) => {
        if (kindOf(entry) === EDIT && index < previous) stale.add(index);
      });
      // With the new one, the last three are kept.
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
      // An entry that arrives while the queue drains joins it.
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

/** The label at a cursor: the account the server authenticated. */
interface Stamp {
  id?: unknown;
  name?: unknown;
  color?: unknown;
}

/**
 * Joins the editor's awareness (`inner`) to the one that crosses the wire
 * (`outer`). This tab's cursor goes out sealed, as `{ sealed }`; a state that
 * arrives is opened and shown under the `user` the server stamped on it, and
 * whatever name was inside is ignored. Returns what stops it.
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
  /** One awareness for each remote client, to make its updates with: an
   * update is applied only with a clock later than the last. */
  const remotes = new Map<number, { doc: Y.Doc; awareness: Awareness }>();
  /** What each remote client's sealed state last opened to. */
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
      const bytes = await unseal(key.presence, state.sealed, data);
      const text = bytes ? fromUtf8(bytes) : null;
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
    // The name and colour are the server's word, never the sender's.
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
  // `update`, not `change`: a peer that has not moved still renews its
  // state, and the editor's awareness drops one it has not heard of lately.
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
      outer.setLocalState({
        sealed: await seal(key.presence, utf8(JSON.stringify(own)), data),
      });
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
