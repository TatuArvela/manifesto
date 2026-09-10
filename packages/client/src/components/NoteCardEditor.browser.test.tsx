import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { DEFAULT_FRAGMENT_NAME } from "../extensions/yjsCollab.js";
import type { NoteYDoc } from "../realtime/yjsProvider.js";

/**
 * The gate: `NoteCardEditor` must withhold `collab` from the editor until the
 * provider reports `synced`. Binding early is silent data loss — `ySyncPlugin`
 * adopts whatever the shared fragment holds, and before the server's state
 * arrives that is nothing, so the note reads as blank and the blank is what
 * gets saved.
 *
 * The provider is the one thing mocked here; a real one would need a server,
 * and the server side of this is already covered end to end by
 * `ws/yjsSocket.test.ts`. Everything below the hook — the remount keyed on
 * `collab`, the fragment seeding, the editor itself — is real, because the
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
  return { ydoc, awareness: null, status: "connecting", synced: false };
}

function synced(ydoc: Y.Doc): NoteYDoc {
  return { ydoc, awareness: null, status: "connected", synced: true };
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
    // document is the authority — the stale row must not be written over it.
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
    };

    show(note);
    await vi.waitFor(() => {
      expect(editorText()).toContain("Milk, eggs, coffee");
    });
  });
});
