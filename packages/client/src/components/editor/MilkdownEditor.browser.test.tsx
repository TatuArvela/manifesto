import type { Editor } from "@milkdown/kit/core";
import { editorStateCtx, editorViewCtx } from "@milkdown/kit/core";
import { Selection } from "@milkdown/kit/prose/state";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import * as Y from "yjs";
import { editorHistory } from "#/extensions/editorHistory.ts";
import { DEFAULT_FRAGMENT_NAME } from "#/extensions/yjsCollab.ts";
import { t } from "#/i18n/index.ts";
import { inlineCalculations } from "#/state/prefs.ts";
import { MilkdownEditor } from "./MilkdownEditor.tsx";

/**
 * The collaborative half of the editor is a three-way handshake between a
 * `Y.XmlFragment`, the document of ProseMirror, and the `content` prop. Each
 * way to do it incorrectly loses a note, and shows no error. If you bind to an
 * empty fragment, the note becomes blank. If you push the prop into a fragment
 * that has content, what the other client wrote is gone. Thus, these tests run
 * against a real editor and a real `Y.Doc`, because a mock of either would be a
 * mock of the thing that the test checks.
 */

const hosts: HTMLDivElement[] = [];

function mountHost(): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  return host;
}

// The listener plugin of Milkdown serializes after a 200ms debounce. A teardown
// inside that window left a timer that threw against a removed context. Thus,
// this teardown had to let the debounce complete first. Now `MilkdownEditor`
// disarms the listener before destroy, and the test below checks that.
afterEach(() => {
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

/**
 * The fragment as `y-prosemirror` writes it: one paragraph that contains one
 * text.
 */
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
    // The note was never opened collaboratively. Thus, the server also has no
    // fragment. See the `synced` control in NoteCardEditor. Because of it, an
    // empty fragment here means "empty in all places", not "not arrived yet".
    // Without the seed, ySyncPlugin adopts the empty fragment, and the note
    // reads as blank.
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
    // The blank would show as an empty document reported up and auto-saved over
    // the note. Thus, check the reports too, not only the end state.
    expect(onChange.mock.calls.map(([md]) => md)).not.toContain("");
  });

  it("leaves a populated fragment alone, even when the note is stale", async () => {
    // The shared document is the authority after it exists. The `content` of
    // this client came from a REST row that a different session possibly edited
    // after that. If the code pushed it into the fragment, it would delete the
    // work of the other session on all devices at the same time.
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
    // A blank new note must not commit a paragraph that the user never typed.
    // The next person who opens it would get it as the shared state.
    const ydoc = new Y.Doc();
    await mountEditor({ content: "", onChange: () => {}, collab: { ydoc } });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ydoc.getXmlFragment(DEFAULT_FRAGMENT_NAME).length).toBe(0);
  });

  it("carries raw-mode edits back into the editor on toggle", async () => {
    // The raw-mode effect is the effect that overwrote the shared fragment on
    // mount, because `editor` is in its dependency array, and its arrival is
    // not a toggle. The skip of the arrival must not also skip the toggle
    // itself.
    const host = mountHost();
    const props = { content: "Written in rich mode", onChange: () => {} };

    render(<MilkdownEditor {...props} rawMode />, host);
    const textarea = await rawTextareaReady(host);
    expect(textarea.value).toBe("Written in rich mode");

    typeInto(textarea, "Edited as markdown");
    // Wait for a macrotask, so that Preact commits the state that the handler
    // queued. A toggle before that would push the value that it replaced.
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(<MilkdownEditor {...props} />, host);

    await vi.waitFor(() => {
      expect(host.querySelector(".ProseMirror")?.textContent).toContain(
        "Edited as markdown",
      );
    });
  });
});

/** The raw textarea, after the editor behind it is up and it accepts typing. */
async function rawTextareaReady(host: HTMLElement) {
  return await vi.waitFor(() => {
    const el = host.querySelector("textarea");
    expect(el).toBeTruthy();
    expect(el?.readOnly).toBe(false);
    return el as HTMLTextAreaElement;
  });
}

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * A second paragraph, written into the fragment as a different client would
 * write it.
 */
function appendRemoteParagraph(ydoc: Y.Doc, text: string) {
  const fragment = ydoc.getXmlFragment(DEFAULT_FRAGMENT_NAME);
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  fragment.insert(fragment.length, [paragraph]);
}

describe("MilkdownEditor raw mode with a shared document", () => {
  // Before, raw mode kept its text to itself until it was toggled back, and
  // then wrote it over the full document. In collab, that lost work in both
  // directions. A note closed in raw mode never reached the fragment. Thus, its
  // next open showed the old text, and saved it back. Also, a look at a note in
  // raw mode overwrote what a collaborator wrote in the meantime. With raw mode
  // as a default, those became the usual path, not an edge case.

  it("opens on the shared document's text, not the note's stale copy", async () => {
    const ydoc = docContaining("What the other session wrote");
    const host = mountHost();
    render(
      <MilkdownEditor
        content="What this client last saw"
        onChange={() => {}}
        rawMode
        collab={{ ydoc }}
      />,
      host,
    );
    const textarea = await rawTextareaReady(host);
    await vi.waitFor(() =>
      expect(textarea.value).toBe("What the other session wrote"),
    );
    expect(fragmentText(ydoc)).not.toContain("What this client last saw");
  });

  it("sends raw edits to the shared document as they are typed", async () => {
    const ydoc = docContaining("Milk");
    const host = mountHost();
    render(
      <MilkdownEditor
        content="Milk"
        onChange={() => {}}
        rawMode
        collab={{ ydoc }}
      />,
      host,
    );
    const textarea = await rawTextareaReady(host);
    typeInto(textarea, "Milk and honey");
    // No toggle and no close: the edit must already be out.
    await vi.waitFor(() =>
      expect(fragmentText(ydoc)).toContain("Milk and honey"),
    );
  });

  it("writes nothing when raw mode is only looked at", async () => {
    const ydoc = docContaining("Leave me be");
    const updates: Uint8Array[] = [];
    ydoc.on("update", (update: Uint8Array) => updates.push(update));
    const host = mountHost();
    const props = {
      content: "Leave me be",
      onChange: () => {},
      collab: { ydoc },
    };
    render(<MilkdownEditor {...props} rawMode />, host);
    await rawTextareaReady(host);
    render(<MilkdownEditor {...props} />, host);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(updates).toHaveLength(0);
  });

  it("shows a collaborator's edit in the textarea", async () => {
    const ydoc = docContaining("Mine");
    const onChange = vi.fn();
    const host = mountHost();
    render(
      <MilkdownEditor
        content="Mine"
        onChange={onChange}
        rawMode
        collab={{ ydoc }}
      />,
      host,
    );
    const textarea = await rawTextareaReady(host);
    appendRemoteParagraph(ydoc, "Theirs");
    await vi.waitFor(() => expect(textarea.value).toBe("Mine\n\nTheirs"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.stringContaining("Theirs"),
    );
  });

  it("keeps a collaborator's edit that lands just before a keystroke", async () => {
    // The listener reports the edit of the collaborator after a debounce. Thus,
    // a keystroke inside that window is pushed from text that does not have it.
    const ydoc = docContaining("Shopping list for the weekend");
    const host = mountHost();
    render(
      <MilkdownEditor
        content="Shopping list for the weekend"
        onChange={() => {}}
        rawMode
        collab={{ ydoc }}
      />,
      host,
    );
    const textarea = await rawTextareaReady(host);
    appendRemoteParagraph(ydoc, "Bring bags");
    typeInto(textarea, "Shopping list for the long weekend");
    await vi.waitFor(() => {
      expect(fragmentText(ydoc)).toContain("long weekend");
      expect(fragmentText(ydoc)).toContain("Bring bags");
    });
    expect(textarea.value).toBe(
      "Shopping list for the long weekend\n\nBring bags",
    );
  });
});

describe("MilkdownEditor undo with a shared document", () => {
  // A collaborative editor has the undo of y-prosemirror in place of the
  // history of Milkdown. It brings no keys, and the toolbar did not see it
  // before. Thus, undo did nothing in a connected instance.
  it("undoes this session's typing from the keyboard and the toolbar's check", async () => {
    const ydoc = docContaining("Shared start");
    let editor: Editor | null = null;
    const editorText = await mountEditor({
      content: "Shared start",
      onChange: () => {},
      collab: { ydoc },
      onEditorReady: (ready) => {
        editor = ready;
      },
    });
    const canUndo = () =>
      editor?.action((ctx) => {
        const state = ctx.get(editorStateCtx);
        return editorHistory(state).undo(state);
      }) ?? false;

    const caretToEnd = () =>
      editor?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.focus();
        view.dispatch(
          view.state.tr.setSelection(Selection.atEnd(view.state.doc)),
        );
      });

    await vi.waitFor(() => expect(editorText()).toContain("Shared start"));
    // The DOM of the editor is there before `onEditorReady` runs, from an
    // effect one render later. Without the editor, `canUndo` is false for no
    // reason, and `caretToEnd` focuses nothing. Thus, the typing goes to the
    // page.
    await vi.waitFor(() => expect(editor).not.toBeNull());
    expect(canUndo()).toBe(false);

    // The caret goes directly to the end. The key for it is different for each
    // platform (Ctrl+End, but Cmd+Down on a Mac), and this test is not about
    // the keys.
    caretToEnd();
    expect(document.activeElement?.classList.contains("ProseMirror")).toBe(
      true,
    );
    await userEvent.keyboard(" and mine");
    await vi.waitFor(() =>
      expect(fragmentText(ydoc)).toContain("Shared start and mine"),
    );
    expect(canUndo()).toBe(true);

    await userEvent.keyboard("{ControlOrMeta>}z{/ControlOrMeta}");
    await vi.waitFor(() =>
      expect(fragmentText(ydoc)).not.toContain("and mine"),
    );
    expect(fragmentText(ydoc)).toContain("Shared start");
  });
});

describe("MilkdownEditor teardown", () => {
  it("names its text field for a screen reader", async () => {
    const host = mountHost();
    render(<MilkdownEditor content="Milk" onChange={() => {}} />, host);
    const view = await vi.waitFor(() => {
      const el = host.querySelector(".ProseMirror");
      if (!el) throw new Error("no editor yet");
      return el;
    });
    expect(view.getAttribute("role")).toBe("textbox");
    expect(view.getAttribute("aria-multiline")).toBe("true");
    expect(view.getAttribute("aria-label")).toBe(t("editor.contentLabel"));
    expect(host.querySelector("textarea")?.getAttribute("aria-label")).toBe(
      t("editor.contentLabel"),
    );
  });

  it("announces a calculation's result, which the text does not carry", async () => {
    const before = inlineCalculations.value;
    inlineCalculations.value = true;
    const host = mountHost();
    render(<MilkdownEditor content="" onChange={() => {}} />, host);
    const view = await vi.waitFor(() => {
      const el = host.querySelector<HTMLElement>(".ProseMirror");
      if (!el) throw new Error("no editor yet");
      return el;
    });
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toBe("");

    view.focus();
    // A result shows after you type the "=".
    document.execCommand("insertText", false, "200+300=");

    await vi.waitFor(() => {
      expect(status?.textContent).toBe(
        t("editor.calcResult", { result: "500" }),
      );
    });
    inlineCalculations.value = before;
  });

  it("does not throw when destroyed inside the listener debounce", async () => {
    // `@milkdown/plugin-listener` gives no way to cancel its pending
    // serialization, and the timer runs where no caller can catch it. The throw
    // reaches `window.onerror` and, in the app, the console of a user who only
    // closed a note immediately after they typed.
    const seen: unknown[] = [];
    const onError = (e: ErrorEvent) => seen.push(e.error ?? e.message);
    window.addEventListener("error", onError);

    const host = mountHost();
    render(<MilkdownEditor content="Milk" onChange={() => {}} />, host);
    await vi.waitFor(() => {
      expect(host.querySelector(".ProseMirror")).toBeTruthy();
    });

    // A keystroke starts the debounce. `insertText` goes through the own input
    // handling of ProseMirror. Thus, the transaction is the transaction for
    // which the plugin listens.
    const view = host.querySelector(".ProseMirror") as HTMLElement;
    view.focus();
    document.execCommand("insertText", false, "y");

    // Unmount well inside the 200ms window, then wait longer than it.
    render(null, host);
    host.remove();
    hosts.splice(hosts.indexOf(host), 1);
    await new Promise((resolve) => setTimeout(resolve, 400));

    window.removeEventListener("error", onError);
    expect(seen).toEqual([]);
  });

  it("tells its parent when the editor it handed over is gone", async () => {
    // A parent that kept the destroyed editor read it on its next render, and
    // each read threw `Context "editorState" not found`.
    const ready = vi.fn();
    const gone = vi.fn();
    const host = mountHost();
    render(
      <MilkdownEditor
        content="Milk"
        onChange={() => {}}
        onEditorReady={ready}
        onEditorGone={gone}
      />,
      host,
    );
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(gone).not.toHaveBeenCalled();

    // Preact 11 runs the cleanup of an effect one frame after the unmount.
    render(null, host);
    await vi.waitFor(() => expect(gone).toHaveBeenCalledOnce());
  });
});

describe("MilkdownEditor links", () => {
  async function mountWithLink(content: string) {
    const host = mountHost();
    let editor: import("@milkdown/kit/core").Editor | null = null;
    render(
      <MilkdownEditor
        content={content}
        onChange={() => {}}
        onEditorReady={(e) => {
          editor = e;
        }}
      />,
      host,
    );
    await vi.waitFor(() => expect(editor).not.toBeNull());
    const link = host.querySelector(".ProseMirror a") as HTMLAnchorElement;
    return { host, link };
  }

  function placeCaretIn(el: Element) {
    const view = el.closest(".ProseMirror") as HTMLElement;
    view.focus();
    const range = document.createRange();
    range.setStart(el.firstChild as Node, 2);
    range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  const tooltip = (host: HTMLElement) =>
    host.querySelector<HTMLElement>(".link-tooltip");

  it("offers to open the link the caret is in, instead of following a click", async () => {
    const { host, link } = await mountWithLink(
      "See [the docs](https://example.com) here",
    );
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);

    placeCaretIn(link);
    await vi.waitFor(() => expect(tooltip(host)?.dataset.open).toBe("true"));
    expect(tooltip(host)?.querySelector("button")?.title).toBe(
      "https://example.com",
    );
  });

  it("does not offer to open a link that is not a web or mail address", async () => {
    // The markdown of a note decides the target. `javascript:` would run in the
    // app.
    const { host, link } = await mountWithLink(
      "Bad [js](javascript:void) link",
    );
    placeCaretIn(link);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tooltip(host)?.dataset.open).not.toBe("true");
  });
});
