import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { DEFAULT_FRAGMENT_NAME } from "#/extensions/yjsCollab.ts";
import { sharedAgreement } from "#/realtime/contentAgreement.ts";
import type { NoteYDoc } from "#/realtime/yjsProvider.ts";

/**
 * The gate: `NoteCardEditor` must not give `collab` to the editor until the
 * provider reports `synced`. An early binding is a silent loss of data.
 * `ySyncPlugin` adopts what the shared fragment contains. Before the state of
 * the server arrives, that is nothing. Thus, the note reads as blank, and the
 * app saves the blank.
 *
 * The provider is the only mock here. A real provider would need a server, and
 * `ws/yjsSocket.test.ts` already covers the server side of this from end to
 * end. All parts below the hook (the remount with `collab` as the key, the fill
 * of the fragment, the editor itself) are real, because the gate must get the
 * three of them correct together.
 */

const provided = { current: null as NoteYDoc | null };

vi.mock("#/realtime/yjsProvider.ts", () => ({
  useNoteYDoc: () => provided.current,
}));

const { NoteCardEditor } = await import("./NoteCardEditor.tsx");
const { notes } = await import("#/state/notesStore.ts");

const NOTE_ID = "01JQZK8V0000000000000NOTE";

function makeNote(content: string): Note {
  return {
    id: NOTE_ID,
    title: "Shopping",
    content,
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    tags: [],
    images: [],
    linkPreviews: [],
    reminder: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function unsynced(ydoc: Y.Doc): NoteYDoc {
  return {
    ydoc,
    awareness: null,
    status: "connecting",
    synced: false,
    outdated: false,
    unreadable: 0,
  };
}

function synced(ydoc: Y.Doc): NoteYDoc {
  return {
    ydoc,
    awareness: null,
    status: "connected",
    synced: true,
    outdated: false,
    unreadable: 0,
  };
}

let host: HTMLDivElement;

/**
 * Renders (or renders again) the editor against the current value of
 * `provided`.
 */
function show(note: Note) {
  render(<NoteCardEditor note={note} onClose={() => {}} />, host);
}

const editorText = () =>
  host.querySelector(".ProseMirror")?.textContent ?? null;

const fragment = (ydoc: Y.Doc) => ydoc.getXmlFragment(DEFAULT_FRAGMENT_NAME);

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
});

// The listener plugin of Milkdown serializes the document after a 200ms
// debounce, and its serializers read the editor view out of the context while
// they run. A teardown inside that window leaves the timer to fire against a
// destroyed editor, and to throw where nothing can catch it. Thus, let the
// debounce complete first.
const LISTENER_DEBOUNCE_MS = 250;

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, LISTENER_DEBOUNCE_MS));
  render(null, host);
  host.remove();
  notes.value = [];
  provided.current = null;
  localStorage.clear();
});

/** Seeds the note where the signal and the storage adapter both look for it. */
function storeNote(note: Note) {
  notes.value = [note];
  localStorage.setItem("manifesto:notes", JSON.stringify([note]));
}

describe("NoteCardEditor collaboration gate", () => {
  it("edits solo, touching no shared state, until the provider syncs", async () => {
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    const ydoc = new Y.Doc();
    provided.current = unsynced(ydoc);

    show(note);
    await vi.waitFor(() => {
      expect(editorText()).toContain("Milk, eggs, coffee");
    });

    // A `Y.Doc` exists and connects, but the editor must not bind to it yet. An
    // empty fragment at this time means "the server did not answer yet", and a
    // write into it makes a note blank.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fragment(ydoc).length).toBe(0);
  });

  it("binds and seeds the shared fragment once the provider syncs", async () => {
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    const ydoc = new Y.Doc();
    provided.current = unsynced(ydoc);

    show(note);
    await vi.waitFor(() => {
      expect(editorText()).toContain("Milk, eggs, coffee");
    });

    provided.current = synced(ydoc);
    show(note);

    // The editor has `collab` as its key. Thus, this is a new instance. The
    // note must stay after the remount, in the shared document and on the
    // screen.
    await vi.waitFor(() => {
      expect(fragment(ydoc).toString()).toContain("Milk, eggs, coffee");
    });
    expect(editorText()).toContain("Milk, eggs, coffee");
  });

  it("shows the server's document rather than the note row it was opened with", async () => {
    // The row from which this client rendered can be behind: a different
    // session edited the note after the list loaded. After the provider syncs,
    // the shared document is the authority, and the old row must not be written
    // over it.
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    const ydoc = new Y.Doc();
    provided.current = unsynced(ydoc);

    show(note);
    await vi.waitFor(() => {
      expect(editorText()).toContain("Milk, eggs, coffee");
    });

    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Milk, eggs, coffee, and rye bread")]);
    fragment(ydoc).insert(0, [paragraph]);
    provided.current = synced(ydoc);
    show(note);

    await vi.waitFor(() => {
      expect(editorText()).toContain("Milk, eggs, coffee, and rye bread");
    });
    expect(fragment(ydoc).toString()).toBe(
      "<paragraph>Milk, eggs, coffee, and rye bread</paragraph>",
    );
  });

  it("stays solo when there is no provider at all", async () => {
    // Open mode: no server. Thus, `useNoteYDoc` reports an idle document, and
    // the editor must still work.
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    provided.current = {
      ydoc: null,
      awareness: null,
      status: "disabled",
      synced: false,
      outdated: false,
      unreadable: 0,
    };

    show(note);
    await vi.waitFor(() => {
      expect(editorText()).toContain("Milk, eggs, coffee");
    });
  });

  it("locks the text and asks for a reload when the server refuses this editor", async () => {
    // A save over REST would write the reading of this build over content that
    // a newer editor put there.
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    provided.current = {
      ydoc: null,
      awareness: null,
      status: "disconnected",
      synced: false,
      outdated: true,
      unreadable: 0,
    };

    show(note);
    await vi.waitFor(() => {
      expect(editorText()).toContain("Milk, eggs, coffee");
      expect(
        host.querySelector(".ProseMirror")?.getAttribute("contenteditable"),
      ).toBe("false");
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Reload",
    );
  });
});

/**
 * A row written from outside the document: the `update_note` of an assistant, a
 * script on the REST API, a restored version. None of them changes Yjs. Thus,
 * the document still contains the old text. Without these, the editor showed
 * that, and saved it back over the change.
 */
describe("NoteCardEditor with a row written from outside the document", () => {
  const SAVED_AT = "2026-01-01T00:00:00.000Z";
  const LATER = "2026-01-01T00:05:00.000Z";

  /** A document that last saved `text`, as the editor records it. */
  function savedDocument(text: string): Y.Doc {
    const ydoc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText(text)]);
    fragment(ydoc).insert(0, [paragraph]);
    const records = sharedAgreement(ydoc, null);
    records.claim(text);
    records.confirm(SAVED_AT);
    return ydoc;
  }

  function writtenLater(content: string): Note {
    return { ...makeNote(content), updatedAt: LATER };
  }

  const versionsSaved = () =>
    localStorage.getItem(`manifesto:versions:${NOTE_ID}`) !== null;

  it("takes the row in when the editor opens", async () => {
    const note = writtenLater("Milk, eggs, coffee, and oat milk");
    storeNote(note);
    const ydoc = savedDocument("Milk, eggs, coffee");
    provided.current = synced(ydoc);

    show(note);

    await vi.waitFor(() => {
      expect(editorText()).toContain("and oat milk");
    });
    expect(fragment(ydoc).toString()).toContain("and oat milk");
    // The document contained nothing unsaved. Thus, there was nothing to keep.
    expect(versionsSaved()).toBe(false);
  });

  it("keeps the document when the row is a text it sent itself", async () => {
    // The save of a different tab that reached the row, claimed before it was
    // sent, while this document moved on since then.
    const ydoc = savedDocument("Milk, eggs, coffee, and rye bread");
    sharedAgreement(ydoc, null).claim("Milk, eggs, coffee");
    const note = writtenLater("Milk, eggs, coffee");
    storeNote(note);
    provided.current = synced(ydoc);

    show(note);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(editorText()).toContain("and rye bread");
  });

  it("keeps text the document never saved as a version before replacing it", async () => {
    const ydoc = savedDocument("Milk, eggs, coffee");
    // Typed offline: in the document, never in the row.
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("and rye bread")]);
    fragment(ydoc).insert(1, [paragraph]);
    const note = writtenLater("Milk, eggs, coffee, and oat milk");
    storeNote(note);
    provided.current = synced(ydoc);

    show(note);

    await vi.waitFor(() => {
      expect(editorText()).toContain("and oat milk");
    });
    await vi.waitFor(() => {
      expect(versionsSaved()).toBe(true);
    });
    expect(localStorage.getItem(`manifesto:versions:${NOTE_ID}`)).not.toBe(
      null,
    );
  });

  it("leaves the change to the client that leads", async () => {
    const note = writtenLater("Milk, eggs, coffee, and oat milk");
    storeNote(note);
    const ydoc = savedDocument("Milk, eggs, coffee");
    const awareness = new Awareness(ydoc);
    // A different client with the document open, and a lower id.
    awareness.states.set(ydoc.clientID - 1, {});
    provided.current = { ...synced(ydoc), awareness };

    show(note);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(editorText()).not.toContain("oat milk");
  });

  it("takes in a row changed while the editor is open", async () => {
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    const ydoc = savedDocument("Milk, eggs, coffee");
    provided.current = synced(ydoc);
    show(note);
    await vi.waitFor(() => {
      expect(editorText()).toContain("Milk, eggs, coffee");
    });

    const changed = writtenLater("Milk, eggs, coffee, and oat milk");
    notes.value = [changed];
    show(changed);

    await vi.waitFor(
      () => {
        expect(editorText()).toContain("and oat milk");
      },
      { timeout: 3000 },
    );
  });

  it("never takes its own saves for outside writes while typing", async () => {
    // Each save changes the row under the editor, which by then moved on. If
    // the code took it in, it would undo what was typed after it.
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    const ydoc = savedDocument("Milk, eggs, coffee");
    provided.current = synced(ydoc);
    // As the board does: the card gives the editor the current row.
    function Live() {
      const row = notes.value.find((n) => n.id === NOTE_ID);
      return row ? <NoteCardEditor note={row} onClose={() => {}} /> : null;
    }
    render(<Live />, host);
    await vi.waitFor(() => {
      expect(editorText()).toContain("Milk, eggs, coffee");
    });

    const view = host.querySelector(".ProseMirror") as HTMLElement;
    view.focus();
    // One word, saved, and then steady typing. The auto-save waits for a pause.
    // Thus, the row stays still while the document goes ahead of it, and the
    // code judges the row in the middle of that.
    document.execCommand("insertText", false, "and ");
    await new Promise((resolve) => setTimeout(resolve, 700));
    for (const char of "rye bread ") {
      document.execCommand("insertText", false, char);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // The caret starts where the focus left it. The important result is that
    // each word is still there, on the screen and in the row.
    for (const text of [editorText(), notes.value[0]?.content]) {
      expect(text).toMatch(/and\s+rye\s+bread/);
      expect(text).toContain("Milk, eggs, coffee");
    }
  });

  it("takes in a restored version with no shared document at all", async () => {
    // Open mode, or a viewer: the own records of the editor, kept in memory.
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    provided.current = {
      ydoc: null,
      awareness: null,
      status: "disabled",
      synced: false,
      outdated: false,
      unreadable: 0,
    };
    show(note);
    // Restored before the editor was built. Thus, only the row with which it
    // opened can tell that this one is newer.
    const restored = writtenLater("Milk");
    notes.value = [restored];
    show(restored);

    await vi.waitFor(() => {
      expect(editorText()).toBe("Milk");
    });
  });
});
