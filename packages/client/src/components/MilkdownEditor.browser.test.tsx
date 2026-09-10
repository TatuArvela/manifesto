import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { DEFAULT_FRAGMENT_NAME } from "../extensions/yjsCollab.js";
import { MilkdownEditor, normalizeMarkdown } from "./MilkdownEditor.js";

/**
 * The collaborative half of the editor is a three-way handshake between a
 * `Y.XmlFragment`, ProseMirror's document, and the `content` prop, and every
 * way of getting it wrong loses a note rather than showing an error: bind to an
 * empty fragment and the note blanks, push the prop into a populated one and
 * whatever the other client wrote is gone. So these run against a real editor
 * and a real `Y.Doc` — a mock of either would be a mock of the thing under
 * test.
 */

const hosts: HTMLDivElement[] = [];

function mountHost(): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  return host;
}

// Milkdown's listener plugin serializes the document on a 200ms debounce, and
// its serializers read the editor view out of the context as they run. Tearing
// down inside that window leaves the timer to fire against a destroyed editor
// and throw where nothing can catch it, so let the debounce drain first.
const LISTENER_DEBOUNCE_MS = 250;

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, LISTENER_DEBOUNCE_MS));
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

async function mountEditor(
  props: Parameters<typeof MilkdownEditor>[0],
): Promise<() => string> {
  const host = mountHost();
  render(<MilkdownEditor {...props} />, host);
  await vi.waitFor(() => {
    expect(host.querySelector(".ProseMirror")).toBeTruthy();
  });
  return () => host.querySelector(".ProseMirror")?.textContent ?? "";
}

/** The fragment as `y-prosemirror` writes it: one paragraph holding one text. */
function docContaining(text: string): Y.Doc {
  const ydoc = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  ydoc.getXmlFragment(DEFAULT_FRAGMENT_NAME).insert(0, [paragraph]);
  return ydoc;
}

const fragmentText = (ydoc: Y.Doc) =>
  ydoc.getXmlFragment(DEFAULT_FRAGMENT_NAME).toString();

describe("MilkdownEditor collaborative binding", () => {
  it("seeds an empty shared fragment from the note", async () => {
    // The note has never been opened collaboratively, so the server has no
    // fragment either — see the `synced` gate in NoteCardEditor, which is what
    // lets an empty fragment here mean "empty everywhere" rather than "not
    // arrived yet". Without the seeding, ySyncPlugin adopts the empty fragment
    // and the note reads as blank.
    const ydoc = new Y.Doc();
    const onChange = vi.fn();
    const editorText = await mountEditor({
      content: "Groceries and other business",
      onChange,
      collab: { ydoc },
    });

    await vi.waitFor(() => {
      expect(fragmentText(ydoc)).toContain("Groceries and other business");
    });
    expect(editorText()).toContain("Groceries and other business");
    // The blanking would surface as an empty document reported upward and
    // auto-saved over the note, so assert on the reports too, not just the end
    // state.
    expect(onChange.mock.calls.map(([md]) => md)).not.toContain("");
  });

  it("leaves a populated fragment alone, even when the note is stale", async () => {
    // The shared document is the authority once it exists: this client's
    // `content` came from a REST row that another session may have edited past.
    // Pushing it into the fragment would delete the other session's work on
    // every device at once.
    const ydoc = docContaining("What the other session wrote");
    const editorText = await mountEditor({
      content: "What this client last saw",
      onChange: () => {},
      collab: { ydoc },
    });

    await vi.waitFor(() => {
      expect(editorText()).toContain("What the other session wrote");
    });
    expect(fragmentText(ydoc)).not.toContain("What this client last saw");
  });

  it("leaves an empty note's fragment empty", async () => {
    // A blank new note must not commit a paragraph the user never typed —
    // whoever opens it next would inherit it as the shared state.
    const ydoc = new Y.Doc();
    await mountEditor({ content: "", onChange: () => {}, collab: { ydoc } });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ydoc.getXmlFragment(DEFAULT_FRAGMENT_NAME).length).toBe(0);
  });

  it("carries raw-mode edits back into the editor on toggle", async () => {
    // The raw-mode effect is the one that used to overwrite the shared
    // fragment on mount, because `editor` is in its dep array and arriving is
    // not a toggle. Skipping the arrival must not cost us the toggle itself:
    // this branch is the only thing that moves textarea edits into the
    // document, so losing it silently discards everything typed in raw mode.
    const host = mountHost();
    const props = { content: "Written in rich mode", onChange: () => {} };

    // Mounting straight into raw mode, rather than toggling into it, keeps the
    // edit below from racing the effect that reads markdown out of the editor.
    render(<MilkdownEditor {...props} rawMode />, host);
    const textarea = await vi.waitFor(() => {
      const el = host.querySelector("textarea");
      expect(el?.value).toBe("Written in rich mode");
      return el as HTMLTextAreaElement;
    });

    textarea.value = "Edited as markdown";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    // Setting `.value` directly means the DOM already reads back the edit, so
    // there is nothing to poll for: yield a macrotask instead and let Preact
    // flush the state update the handler queued. Toggling before that commit
    // would push the value it replaced.
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(<MilkdownEditor {...props} />, host);

    await vi.waitFor(() => {
      expect(host.querySelector(".ProseMirror")?.textContent).toContain(
        "Edited as markdown",
      );
    });
  });
});

describe("normalizeMarkdown", () => {
  const fence = "```";

  it("unescapes the brackets prosemirror-markdown added", () => {
    expect(normalizeMarkdown("Post \\[ \\] Maa")).toBe("Post [ ] Maa");
  });

  it("leaves brackets inside a code block escaped", () => {
    // A note explaining how to escape a bracket had its own example silently
    // corrected, so the thing it was demonstrating stopped being visible.
    const md = ["Escape it:", fence, "\\[not a box\\]", fence].join("\n");
    expect(normalizeMarkdown(md)).toBe(md);
  });

  it("collapses the blank lines mdast puts between list items", () => {
    expect(normalizeMarkdown("- one\n\n- two")).toBe("- one\n- two");
  });

  it("keeps a blank line inside a code block", () => {
    // Two lines starting with `-` and a gap between them is a diff, not a
    // list; closing the gap changes what the code says.
    const md = [fence, "- one", "", "- two", fence].join("\n");
    expect(normalizeMarkdown(md)).toBe(md);
  });

  it("keeps a blank line that is not between two list items", () => {
    expect(normalizeMarkdown("para\n\n- one")).toBe("para\n\n- one");
  });
});
