import { listenerCtx } from "@milkdown/kit/plugin/listener";
import { getMarkdown } from "@milkdown/kit/utils";
import { editorWasBuilt, makeNoteEditor } from "./makeNoteEditor.ts";

/** Markdown with each kind of block and mark that a note often has. */
const SAMPLE = [
  "# A heading",
  "",
  'Text in **bold**, _italic_, `code`, ~~struck~~, a [link](https://example.com) and <span data-color="red">a color</span>.',
  "",
  "- One",
  "- Two",
  "",
  "1. First",
  "2. Second",
  "",
  "- [ ] A task @2026-01-01",
  "- [x] A done task",
  "",
  "> A quote",
  "",
  "```",
  "A block of code",
  "```",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "---",
].join("\n");

/**
 * Builds one editor that nobody sees, and destroys it. `lazyEditor.ts` asks
 * for this in idle time after the editor chunk arrives.
 *
 * The first open of a note in a session ran the code of the editor for the
 * first time: the browser compiled it, and Milkdown made its parser and its
 * plugins for the first time. In a production build with 86 notes, the task
 * of that click took 105 to 180 ms, against 40 to 55 ms for the next opens.
 *
 * The editor is in an element that is not on the page. Thus, it has no style
 * and no layout, and nothing shows. Nothing changes its document, so the
 * listener of Milkdown starts no timer. When a note opened first, there is
 * nothing to do.
 */
export async function warmUpEditor(): Promise<void> {
  if (editorWasBuilt()) return;
  const editor = makeNoteEditor(document.createElement("div"), {
    initialContent: SAMPLE,
    onMarkdown: () => {},
    resolveInlineImage: () => Promise.resolve(null),
    inlineImageControls: () => undefined,
    documentChanged: () => {},
    collab: null,
  });
  try {
    await editor.create();
    // The serializer, which each save of a note runs.
    editor.action(getMarkdown());
    editor.action((ctx) => {
      const { listeners } = ctx.get(listenerCtx);
      listeners.markdownUpdated.length = 0;
      listeners.updated.length = 0;
    });
  } catch {
    // A warm-up that fails changes nothing: the first note builds as before.
  } finally {
    await editor.destroy().catch(() => {});
  }
}
