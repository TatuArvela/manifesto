import { NoteColor, NoteFont } from "@manifesto/shared";
import type { Editor } from "@milkdown/kit/core";
import { getMarkdown } from "@milkdown/kit/utils";
import { h, render } from "preact";
import { editorWasBuilt } from "./makeNoteEditor.ts";
import { NoteEditor } from "./NoteEditor.tsx";

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

const nothing = () => {};

/**
 * Renders the editor of a note one time where nobody sees it, and takes it
 * down. `lazyEditor.ts` asks for this in idle time after the editor chunk
 * arrives.
 *
 * The first open of a note in a session ran the code of the editor for the
 * first time, and the browser compiled it then. In a production build with 86
 * notes, the task of that click took 105 to 180 ms, against 40 to 55 ms for
 * the next opens. A warm-up of Milkdown alone left it at 80 to 107 ms: the
 * components around it (the bars, the chips, `MilkdownEditor`) also ran for
 * the first time in that click. Thus, it renders the full `NoteEditor`.
 *
 * All of it occurs in one task. The editor is in an element that is not on the
 * page: it has no style and no layout, nothing shows, and nothing can take the
 * focus (`autoFocus` is off). Milkdown builds in microtasks, and Preact
 * renders in microtasks. Thus, no input and no paint come between the mount
 * and the unmount, and no `useEffect` runs: an effect waits for a paint, and
 * Preact skips the effects of a component that is gone. Its callbacks do
 * nothing, and nothing changes its document. Thus, the listener of Milkdown
 * starts no timer.
 *
 * An editor that does not report in that task (a build that failed, or one
 * that waits for something) is taken down at the start of the next task. That
 * comes before any effect of it: Preact runs effects in a task that the next
 * frame queues, after this one. When the warm-up waited 3 s for such an
 * editor, its effects ran, and its paste listener took a real paste.
 *
 * Each editor closes only a drawing pad that it opened (`useTextImages`).
 * Thus, the warm-up can run while a pad is open. It does nothing when a note
 * opened first.
 */
export async function warmUpEditor(): Promise<void> {
  if (editorWasBuilt()) return;
  const root = document.createElement("div");
  let reportEditor: (editor: Editor) => void = nothing;
  const built = new Promise<Editor | null>((resolve) => {
    reportEditor = resolve;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), 0);
  });
  try {
    render(
      h(NoteEditor, {
        title: "",
        onTitleChange: nothing,
        content: SAMPLE,
        onContentChange: nothing,
        color: NoteColor.Default,
        onColorChange: nothing,
        font: NoteFont.Default,
        onFontChange: nothing,
        images: [],
        onAddImages: nothing,
        onRemoveImage: nothing,
        linkPreviews: [],
        onAddLinkPreviews: nothing,
        onRemoveLinkPreview: nothing,
        pinned: false,
        onPinToggle: nothing,
        tags: ["sample"],
        onAddTag: nothing,
        onRemoveTag: nothing,
        reminder: null,
        onReminderChange: nothing,
        onDone: nothing,
        autoFocus: false,
        onEditorReady: (editor) => reportEditor(editor),
      }),
      root,
    );
    const editor = await Promise.race([built, late]);
    // The serializer, which each save of a note runs.
    editor?.action(getMarkdown());
    // The render with the editor, which brings the formatting bar. Preact
    // renders it in a microtask after the report.
    for (let turn = 0; turn < 3; turn++) await Promise.resolve();
  } catch {
    // A warm-up that fails changes nothing: the first note builds as before.
  } finally {
    clearTimeout(timer);
    render(null, root);
  }
}
