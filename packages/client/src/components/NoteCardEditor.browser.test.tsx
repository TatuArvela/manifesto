import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { DEFAULT_FRAGMENT_NAME } from "../extensions/yjsCollab.js";
import { sharedAgreement } from "../realtime/contentAgreement.js";
import type { NoteYDoc } from "../realtime/yjsProvider.js";

/**
 * The gate: `NoteCardEditor` must withhold `collab` from the editor until the
 * provider reports `synced`. Binding early is silent data loss: `ySyncPlugin`
 * adopts whatever the shared fragment holds, and before the server's state
 * arrives that is nothing, so the note reads as blank and the blank is what
 * gets saved.
 *
 * The provider is the one thing mocked here; a real one would need a server,
 * and the server side of this is already covered end to end by
 * `ws/yjsSocket.test.ts`. Everything below the hook (the remount keyed on
 * `collab`, the fragment seeding, the editor itself) is real, because the
 * three of them together are what the gate has to get right.
 */

const provided = { current: null as NoteYDoc | null };

vi.mock("../realtime/yjsProvider.js", () => ({
  useNoteYDoc: () => provided.current,
}));

const { NoteCardEditor } = await import("./NoteCardEditor.js");
const { notes } = await import("../state/index.js");

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
  };
}

function synced(ydoc: Y.Doc): NoteYDoc {
  return {
    ydoc,
    awareness: null,
    status: "connected",
    synced: true,
    outdated: false,
  };
}

let host: HTMLDivElement;

/** Renders (or re-renders) the editor against whatever `provided` now holds. */
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

// Milkdown's listener plugin serializes the document on a 200ms debounce, and
// its serializers read the editor view out of the context as they run. Tearing
// down inside that window leaves the timer to fire against a destroyed editor
// and throw where nothing can catch it, so let the debounce drain first.
const LISTENER_DEBOUNCE_MS = 250;

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, LISTENER_DEBOUNCE_MS));
  render(null, host);
  host.remove();
  notes.value = [];
  provided.current = null;
  localStorage.clear();
});

/** Seeds the note where both the signal and the storage adapter look for it. */
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

    // A `Y.Doc` exists and is connecting, but the editor must not be bound to
    // it yet. An empty fragment at this point means "the server has not spoken
    // yet", and writing into it is how a note gets blanked.
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

    // The editor is keyed on `collab`, so this is a fresh instance: the note
    // has to survive the remount, in the shared document as well as on screen.
    await vi.waitFor(() => {
      expect(fragment(ydoc).toString()).toContain("Milk, eggs, coffee");
    });
    expect(editorText()).toContain("Milk, eggs, coffee");
  });

  it("shows the server's document rather than the note row it was opened with", async () => {
    // The row this client rendered from can be behind: another session edited
    // the note after the list was fetched. Once the provider syncs, the shared
    // document is the authority, and the stale row must not be written over it.
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
    // Open mode: no server, so `useNoteYDoc` reports an idle document and the
    // editor has to work anyway.
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    provided.current = {
      ydoc: null,
      awareness: null,
      status: "disabled",
      synced: false,
      outdated: false,
    };

    show(note);
    await vi.waitFor(() => {
      expect(editorText()).toContain("Milk, eggs, coffee");
    });
  });

  it("locks the text and asks for a reload when the server refuses this editor", async () => {
    // Saving over REST instead would write this build's reading of the note
    // over content a newer editor put there.
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    provided.current = {
      ydoc: null,
      awareness: null,
      status: "disconnected",
      synced: false,
      outdated: true,
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
 * A row written from outside the document: an assistant's `update_note`, a
 * script on the REST API, a restored version. None of them touch Yjs, so the
 * document still holds the text from before, and without these the editor
 * showed that and saved it back over the change.
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
    // The document held nothing unsaved, so there was nothing to keep.
    expect(versionsSaved()).toBe(false);
  });

  it("keeps the document when the row is a text it sent itself", async () => {
    // Another tab's save that reached the row, claimed before it was sent,
    // while this document has moved on since.
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
    // Another client with the document open, and a lower id.
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
    // Each save changes the row under the editor, which by then has moved on.
    // Taken in, it would undo whatever was typed after it.
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    const ydoc = savedDocument("Milk, eggs, coffee");
    provided.current = synced(ydoc);
    // As the board does: the card hands the editor the row as it now stands.
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
    // One word, saved, and then steady typing: the auto-save waits for a
    // pause, so the row stands still while the document runs ahead of it,
    // and the row is judged in the middle of that.
    document.execCommand("insertText", false, "and ");
    await new Promise((resolve) => setTimeout(resolve, 700));
    for (const char of "rye bread ") {
      document.execCommand("insertText", false, char);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // The caret starts where the focus left it; what matters is that every
    // word is still there, on screen and in the row.
    for (const text of [editorText(), notes.value[0].content]) {
      expect(text).toMatch(/and\s+rye\s+bread/);
      expect(text).toContain("Milk, eggs, coffee");
    }
  });

  it("takes in a restored version with no shared document at all", async () => {
    // Open mode, or a viewer: the editor's own records, kept in memory.
    const note = makeNote("Milk, eggs, coffee");
    storeNote(note);
    provided.current = {
      ydoc: null,
      awareness: null,
      status: "disabled",
      synced: false,
      outdated: false,
    };
    show(note);
    // Restored before the editor has even been built, so nothing but the row
    // it was opened with can say this one is newer.
    const restored = writtenLater("Milk");
    notes.value = [restored];
    show(restored);

    await vi.waitFor(() => {
      expect(editorText()).toBe("Milk");
    });
  });
});
