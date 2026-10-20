import {
  EDITOR_SCHEMA_VERSION,
  type NoteSealKey,
  newNoteKey,
  noteSealKey,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { LOCAL_COPY_PREFIX } from "./localNoteCopies.ts";
import { joinSealedDocument } from "./sealedDocument.ts";
import { createYjsSession, type YjsSessionOptions } from "./yjsSession.ts";

/**
 * The socket and the offline copy are replaced here. Thus, the test checks the
 * connections that `createYjsSession` makes between them: which document goes
 * on the wire, when the editor learns that it synced, and the order of the
 * closes. `sealedDocument.test.ts` tests the seal itself.
 */

interface FakeProvider {
  options: {
    url: string;
    name: string;
    document: Y.Doc;
    onSynced: () => void;
  };
  awareness: Awareness;
  destroy: ReturnType<typeof vi.fn>;
}

const fakes = vi.hoisted(() => ({
  providers: [] as FakeProvider[],
  copies: [] as { name: string; destroy: () => Promise<void> }[],
  deleted: [] as string[][],
}));

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    options: FakeProvider["options"];
    awareness: Awareness;
    destroy = vi.fn(() => this.awareness.destroy());
    constructor(options: FakeProvider["options"]) {
      this.options = options;
      this.awareness = new Awareness(options.document);
      fakes.providers.push(this as unknown as FakeProvider);
    }
  },
}));

vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    destroy = vi.fn(async () => {});
    constructor(name: string) {
      fakes.copies.push({ name, destroy: this.destroy });
    }
  },
}));

vi.mock("./localNoteCopies.ts", async (original) => ({
  ...(await original<typeof import("./localNoteCopies.ts")>()),
  deleteReadableNoteCopies: async (ids: string[]) => {
    fakes.deleted.push(ids);
  },
}));

const NOTE = "n1";
const USER = { id: "u1", name: "Ada Lovelace", color: "#123456" };

function provider(): FakeProvider {
  const last = fakes.providers.at(-1);
  if (!last) throw new Error("No provider was created");
  return last;
}

function open(overrides: Partial<YjsSessionOptions> = {}) {
  const calls = { synced: 0, statuses: [] as string[] };
  const session = createYjsSession({
    url: "wss://notes.example/collab",
    noteId: NOTE,
    token: "t",
    key: null,
    user: USER,
    onStatus: (status) => calls.statuses.push(status),
    onSynced: () => {
      calls.synced++;
    },
    onUnreadable: () => {},
    onAuthenticationFailed: () => {},
    ...overrides,
  });
  return { session, calls };
}

describe("createYjsSession", () => {
  let key: NoteSealKey;

  beforeEach(async () => {
    vi.stubGlobal("window", new EventTarget());
    key = await noteSealKey(newNoteKey(), 1);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fakes.providers.length = 0;
    fakes.copies.length = 0;
    fakes.deleted.length = 0;
  });

  it("names the document by the note and tells the server its editor version", () => {
    const { session } = open();
    expect(provider().options.name).toBe(NOTE);
    expect(provider().options.url).toBe(
      `wss://notes.example/collab?editor=${EDITOR_SCHEMA_VERSION}`,
    );
    expect(fakes.copies.map((copy) => copy.name)).toEqual([
      `${LOCAL_COPY_PREFIX}${NOTE}`,
    ]);
    expect(fakes.deleted).toEqual([[NOTE]]);
    session.destroy();
  });

  it("syncs the editor's own document when there is no key", () => {
    const { session, calls } = open();
    expect(provider().options.document).toBe(session.ydoc);
    provider().options.onSynced();
    expect(calls.synced).toBe(1);
    session.destroy();
  });

  it("puts a second, sealed document on the wire, under the editor's client id", () => {
    const { session } = open({ key });
    const wire = provider().options.document;
    expect(wire).not.toBe(session.ydoc);
    expect(wire.clientID).toBe(session.ydoc.clientID);
    session.ydoc.getText("body").insert(0, "secret words");
    expect(JSON.stringify(wire.toJSON())).not.toContain("secret words");
    session.destroy();
  });

  it("says it has synced only once what arrived has been opened", async () => {
    // Another editor's sealed edit, as the server would hand it over.
    const otherInner = new Y.Doc();
    const otherOuter = new Y.Doc();
    const other = joinSealedDocument({
      noteId: NOTE,
      key,
      inner: otherInner,
      outer: otherOuter,
    });
    otherInner.getText("body").insert(0, "from elsewhere");
    await other.destroy();

    let textWhenSynced: string | null = null;
    const { session } = open({
      key,
      onSynced: () => {
        textWhenSynced = session.ydoc.getText("body").toString();
      },
    });
    Y.applyUpdate(
      provider().options.document,
      Y.encodeStateAsUpdate(otherOuter),
    );
    provider().options.onSynced();
    await vi.waitFor(() => expect(textWhenSynced).toBe("from elsewhere"));
    session.destroy();
  });

  it("sends a sealed cursor with the user's label kept off the wire", () => {
    const { session } = open({ key });
    expect(session.awareness).not.toBe(provider().awareness);
    expect(session.awareness?.getLocalState()?.user).toEqual(USER);
    session.destroy();
  });

  it("takes the cursor away when the tab is closed", () => {
    const { session } = open();
    provider().awareness.setLocalStateField("cursor", { at: 1 });
    window.dispatchEvent(new Event("pagehide"));
    expect(provider().awareness.getLocalState()).toBeNull();
    session.destroy();
  });

  it("closes the socket only after the last edits are sealed onto the wire", async () => {
    const { session } = open({ key });
    const wire = provider().options.document;
    let wireUpdates = 0;
    wire.on("update", () => {
      wireUpdates++;
    });
    session.ydoc.getText("body").insert(0, "last words");
    session.destroy();
    expect(provider().destroy).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(provider().destroy).toHaveBeenCalled());
    expect(wireUpdates).toBeGreaterThan(0);
    expect(fakes.copies[0]?.destroy).toHaveBeenCalled();
  });

  it("closes at once when nothing is being sealed", () => {
    const { session } = open();
    session.destroy();
    expect(provider().destroy).toHaveBeenCalled();
  });
});
