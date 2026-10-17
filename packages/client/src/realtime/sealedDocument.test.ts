import { type NoteSealKey, newNoteKey, noteSealKey } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";
import {
  joinSealedAwareness,
  joinSealedDocument,
  type SealedDocument,
} from "./sealedDocument.ts";

/**
 * Two editors and the server between them. The server here is what the real
 * one is for a note's document: a Yjs document it merges and stores, and
 * never reads.
 */

interface Client {
  inner: Y.Doc;
  outer: Y.Doc;
  joined: SealedDocument;
  text: () => string;
  type: (text: string) => void;
}

const NOTE = "n1";
const cleanups: (() => void)[] = [];

function client(
  key: NoteSealKey,
  noteId = NOTE,
  older?: ReadonlyMap<number, NoteSealKey>,
): Client {
  const inner = new Y.Doc();
  const outer = new Y.Doc();
  const joined = joinSealedDocument({ noteId, key, older, inner, outer });
  cleanups.push(() => joined.destroy());
  const body = inner.getText("body");
  return {
    inner,
    outer,
    joined,
    text: () => body.toString(),
    type: (text) => body.insert(body.length, text),
  };
}

/** Carries everything each outer document has to the others, as the socket
 * would, and waits for every client to have opened what arrived. */
async function sync(server: Y.Doc, ...clients: Client[]): Promise<void> {
  for (const c of clients) await c.joined.settled();
  for (const c of clients)
    Y.applyUpdate(server, Y.encodeStateAsUpdate(c.outer));
  for (const c of clients)
    Y.applyUpdate(c.outer, Y.encodeStateAsUpdate(server));
  for (const c of clients) await c.joined.settled();
}

const contains = (bytes: Uint8Array, text: string) =>
  new TextDecoder("latin1").decode(bytes).includes(text);

describe("a sealed shared document", () => {
  let key: NoteSealKey;
  let server: Y.Doc;

  beforeEach(async () => {
    key = await noteSealKey(newNoteKey(), 1);
    server = new Y.Doc();
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("carries one editor's text to another through a server that cannot read it", async () => {
    const a = client(key);
    const b = client(key);
    a.type("Meet at the harbour at nine");
    await sync(server, a, b);
    expect(b.text()).toBe("Meet at the harbour at nine");

    const stored = Y.encodeStateAsUpdate(server);
    expect(contains(stored, "harbour")).toBe(false);
    // The readable document is a different thing, and it does hold it.
    expect(contains(Y.encodeStateAsUpdate(a.inner), "harbour")).toBe(true);
  });

  it("merges what two people typed at once", async () => {
    const a = client(key);
    const b = client(key);
    a.type("shared ");
    await sync(server, a, b);
    a.type("alpha ");
    b.type("beta ");
    await sync(server, a, b);
    expect(a.text()).toBe(b.text());
    expect(a.text()).toContain("alpha");
    expect(a.text()).toContain("beta");
  });

  it("opens a note cold from what the server stored", async () => {
    const a = client(key);
    a.type("first ");
    a.type("second");
    await sync(server, a);
    const late = client(key);
    await sync(server, late);
    expect(late.text()).toBe("first second");
  });

  it("reads what an earlier key wrote, and writes only under the one the note has now", async () => {
    const a = client(key);
    a.type("before ");
    await sync(server, a);

    // The note's key is replaced: whoever joins now holds the new one, and
    // the old one to read with.
    const next = await noteSealKey(newNoteKey(), 2);
    const join = (older?: ReadonlyMap<number, NoteSealKey>) => {
      const inner = new Y.Doc();
      const outer = new Y.Doc();
      const joined = joinSealedDocument({
        noteId: NOTE,
        key: next,
        older,
        inner,
        outer,
      });
      cleanups.push(() => joined.destroy());
      const body = inner.getText("body");
      return {
        inner,
        outer,
        joined,
        text: () => body.toString(),
        type: (text: string) => body.insert(body.length, text),
      };
    };
    const b = join(new Map([[1, key]]));
    await sync(server, b);
    expect(b.text()).toBe("before ");
    b.type("after");
    await sync(server, b);

    // Someone with the new key alone opens nothing the old one wrote;
    // someone still on the old one, only what came before.
    const fresh = join();
    await sync(server, fresh);
    expect(fresh.text()).not.toContain("before");
    expect(fresh.joined.unreadable()).toBeGreaterThan(0);
    const left = client(key);
    await sync(server, left);
    expect(left.text()).toBe("before ");
  });

  it("opens nothing with another note's key, or under another note's name", async () => {
    const a = client(key);
    a.type("private");
    await sync(server, a);

    const stranger = client(await noteSealKey(newNoteKey(), 1));
    await sync(server, stranger);
    expect(stranger.text()).toBe("");
    expect(stranger.joined.unreadable()).toBeGreaterThan(0);

    // The same key, the log moved under another note.
    const moved = client(key, "n2");
    await sync(server, moved);
    expect(moved.text()).toBe("");
  });

  it("folds edits into a snapshot, and a cold open still reads everything", async () => {
    const a = client(key);
    for (let i = 0; i < 30; i++) a.type(`${i} `);
    await sync(server, a);
    const log = a.outer.getArray<Uint8Array>("log");
    const before = log.length;
    expect(before).toBe(30);

    // The first snapshot keeps the edits it covers; the one after lets
    // them go.
    await a.joined.compact(true);
    expect(log.length).toBe(before + 1);
    a.type("tail");
    await a.joined.compact(true);
    expect(log.length).toBe(3);
    await sync(server, a);

    const late = client(key);
    await sync(server, late);
    expect(late.text()).toBe(a.text());
    expect(late.text().endsWith("tail")).toBe(true);
  });

  it("leaves what a newer key wrote to whoever holds it, when one still on the old key folds", async () => {
    const next = await noteSealKey(newNoteKey(), 2);
    const behind = client(key);
    const moved = client(next, NOTE, new Map([[1, key]]));
    behind.type("old ");
    moved.type("new ");
    await sync(server, behind, moved);
    expect(behind.joined.unreadable()).toBe(1);

    // Two snapshots, the second of which would let go of the edits before
    // the first: the newer key's among them, which neither of them holds.
    await behind.joined.compact(true);
    behind.type("more ");
    await behind.joined.compact(true);
    await sync(server, behind);

    const late = client(next, NOTE, new Map([[1, key]]));
    await sync(server, late);
    expect(late.text()).toContain("new");
    expect(late.text()).toContain("more");
  });

  it("keeps the last three snapshots", async () => {
    const a = client(key);
    for (let round = 0; round < 6; round++) {
      a.type(`${round}`);
      await a.joined.compact(true);
    }
    const kinds = a.outer
      .getArray<Uint8Array>("log")
      .toArray()
      .map((entry) => entry[0]);
    expect(kinds.filter((kind) => kind === 1)).toHaveLength(3);
  });

  it("does not fold a few edits unless asked", async () => {
    const a = client(key);
    a.type("x");
    await a.joined.compact();
    expect(a.outer.getArray("log").length).toBe(1);
  });

  it("writes an edit made just before it was closed", async () => {
    const a = client(key);
    a.type("last words");
    // Closed at once, with the edit still being sealed.
    const closed = a.joined.destroy();
    expect(a.outer.getArray("log").length).toBe(0);
    await closed;
    expect(a.outer.getArray("log").length).toBe(1);
    // Nothing made after it is carried.
    a.type(" and more");
    await a.joined.settled();
    expect(a.outer.getArray("log").length).toBe(1);
    Y.applyUpdate(server, Y.encodeStateAsUpdate(a.outer));
    const late = client(key);
    await sync(server, late);
    expect(late.text()).toBe("last words");
  });

  it("passes over an entry that does not open, and reads the rest", async () => {
    const a = client(key);
    a.type("kept");
    await sync(server, a);
    // What a faulty or hostile writer might append.
    const junk = new Uint8Array(60);
    junk[0] = 1;
    junk[4] = 1;
    server.getArray<Uint8Array>("log").push([junk]);
    const late = client(key);
    await sync(server, late);
    expect(late.text()).toBe("kept");
    expect(late.joined.unreadable()).toBe(1);
  });
});

describe("presence over a sealed document", () => {
  it("does not send a cursor again once stopped while sealing it", async () => {
    const real = await noteSealKey(newNoteKey(), 1);
    let sealing = (): void => {};
    let release = (): void => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // A presence key that is slow to come, so the cursor is caught mid-seal.
    const key: NoteSealKey = {
      ...real,
      edits: () => real.edits(),
      presence: async () => {
        sealing();
        await gate;
        return real.presence();
      },
    };
    const inner = new Awareness(new Y.Doc());
    const outer = new Awareness(new Y.Doc());
    const started = new Promise<void>((r) => {
      sealing = r;
    });
    const stop = joinSealedAwareness({ noteId: NOTE, key, inner, outer });
    inner.setLocalState({ cursor: { anchor: 1, head: 1 } });
    await started;
    // Closed with that cursor still being sealed, as an editor that leaves
    // clears what it sent.
    stop();
    outer.setLocalState(null);
    release();
    await new Promise((r) => setTimeout(r, 30));
    expect(outer.getLocalState()).toBeNull();
    inner.destroy();
    outer.destroy();
  });

  it("sends a cursor sealed, and shows it under the name the server stamped", async () => {
    const key = await noteSealKey(newNoteKey(), 1);
    const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc(), new Y.Doc()];
    const [aInner, aOuter, bInner, bOuter] = docs.map((d) => new Awareness(d));
    if (!aInner || !aOuter || !bInner || !bOuter) throw new Error("no docs");
    const stop = [
      joinSealedAwareness({ noteId: NOTE, key, inner: aInner, outer: aOuter }),
      joinSealedAwareness({ noteId: NOTE, key, inner: bInner, outer: bOuter }),
    ];
    try {
      aInner.setLocalState({
        cursor: { anchor: 3, head: 7 },
        // What a client says of itself is not what anyone is shown.
        user: { name: "Someone Else", color: "#000" },
      });
      await new Promise((r) => setTimeout(r, 30));

      const sent = aOuter.getLocalState() as Record<string, unknown>;
      expect(Object.keys(sent)).toEqual(["sealed"]);
      expect(JSON.stringify(sent)).not.toContain("anchor");

      // The server passes the state on with the account it authenticated.
      const stampDoc = new Y.Doc();
      stampDoc.clientID = aOuter.clientID;
      const stamp = new Awareness(stampDoc);
      stamp.setLocalState({
        ...sent,
        user: { id: "u-alice", name: "Alice", color: "#f00" },
      });
      applyAwarenessUpdate(
        bOuter,
        encodeAwarenessUpdate(stamp, [aOuter.clientID]),
        "server",
      );
      await new Promise((r) => setTimeout(r, 30));

      expect(bInner.getStates().get(aOuter.clientID)).toEqual({
        cursor: { anchor: 3, head: 7 },
        user: { id: "u-alice", name: "Alice", color: "#f00" },
      });

      // Leaving takes the cursor away.
      stamp.setLocalState(null);
      applyAwarenessUpdate(
        bOuter,
        encodeAwarenessUpdate(stamp, [aOuter.clientID]),
        "server",
      );
      await new Promise((r) => setTimeout(r, 30));
      expect(bInner.getStates().has(aOuter.clientID)).toBe(false);
      stamp.destroy();
    } finally {
      for (const s of stop) s();
      for (const a of [aInner, aOuter, bInner, bOuter]) a.destroy();
    }
  });
});
