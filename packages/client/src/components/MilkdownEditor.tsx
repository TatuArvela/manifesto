import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { TextSelection } from "@milkdown/kit/prose/state";
import { getMarkdown, replaceAll } from "@milkdown/kit/utils";
import type { RefObject } from "preact";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import type * as Y from "yjs";
import { inlineCalculationsPlugin } from "../extensions/inlineCalculations.js";
import { manifestoInlineMarks } from "../extensions/manifestoInlineMarks.js";
import { taskItemDraggable } from "../extensions/taskItemDraggable.js";
import {
  DEFAULT_FRAGMENT_NAME,
  loadYjsCollab,
  type YjsCollabFactory,
} from "../extensions/yjsCollab.js";
import { useMilkdownEditor } from "../hooks/useMilkdownEditor.js";
import { markFencedLines } from "../utils/markdown.js";

/** prosemirror-markdown escapes `[` `]` per CommonMark; our content uses literal
 * brackets (e.g. "Post [ ] Maa"), so we unescape them on readout.
 *
 * Not inside a code block: there the backslash is content, and a note showing
 * how to escape a bracket had its own example silently corrected. Code spans
 * are left alone for the same reason. */
function unescapeBrackets(md: string): string {
  const lines = md.split("\n");
  const fenced = markFencedLines(lines);
  return lines
    .map((line, i) => (fenced[i] ? line : line.replace(/\\([[\]])/g, "$1")))
    .join("\n");
}

const LIST_LINE_RE = /^\s*(?:[-*+] |\d+[.)] )/;

/** mdast's "spread" lists insert blank lines between items on stringify. Our
 * preview treats each blank line as a segment gap, which balloons a simple
 * checklist into disconnected blocks. Collapse blank lines that only sit
 * between two list items, never inside a fence, where a blank line between
 * two lines that happen to start with `-` is part of the code. */
function collapseListSpread(md: string): string {
  const lines = md.split("\n");
  const fenced = markFencedLines(lines);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "" && out.length > 0 && !fenced[i]) {
      const prev = out[out.length - 1];
      let j = i;
      while (j < lines.length && lines[j].trim() === "" && !fenced[j]) j++;
      const next = lines[j] ?? "";
      if (!fenced[j] && LIST_LINE_RE.test(prev) && LIST_LINE_RE.test(next)) {
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

/**
 * The two post-processing passes above, in the order `getMarkdown` needs
 * them. Exported so they can be tested without standing up an editor.
 */
export function normalizeMarkdown(md: string): string {
  return collapseListSpread(unescapeBrackets(md));
}

export function getEditorMarkdown(editor: Editor): string {
  return normalizeMarkdown(editor.action(getMarkdown()));
}

interface MilkdownEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  disabled?: boolean;
  contentLocked?: boolean;
  rawMode?: boolean;
  /** Receives the raw-mode textarea, so the toolbar can format its text. */
  textareaRef?: RefObject<HTMLTextAreaElement>;
  autoFocus?: boolean;
  onEditorReady?: (editor: Editor) => void;
  collab?: {
    ydoc: Y.Doc;
    fragmentName?: string;
    awareness?: import("y-protocols/awareness").Awareness;
  };
}

export function MilkdownEditor({
  content,
  onChange,
  disabled,
  contentLocked,
  rawMode,
  textareaRef: externalTextareaRef,
  autoFocus,
  onEditorReady,
  collab,
}: MilkdownEditorProps) {
  const ownTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef ?? ownTextareaRef;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  const initialContentRef = useRef(content);

  const [rawContent, setRawContent] = useState(content);
  const rawContentRef = useRef(rawContent);
  rawContentRef.current = rawContent;

  const collabRef = useRef(collab);
  collabRef.current = collab;

  // The collaborative plugin is fetched on demand, so a collaborative editor
  // cannot be built until it lands. See `loadYjsCollab` for why it must be in
  // hand *before* the editor is created rather than awaited inside the plugin.
  // Held in a ref as well: `build` reads it without taking it as a dependency.
  const [collabFactory, setCollabFactory] = useState<YjsCollabFactory | null>(
    null,
  );
  const collabFactoryRef = useRef(collabFactory);
  collabFactoryRef.current = collabFactory;

  useEffect(() => {
    if (!collab) return;
    let cancelled = false;
    loadYjsCollab().then(
      (factory) => {
        // setState with a function argument would call it as an updater.
        if (!cancelled) setCollabFactory(() => factory);
      },
      () => {
        // Leaves the editor unbuilt rather than silently non-collaborative:
        // binding solo here would let this client's copy overwrite the shared
        // document on the next save.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [collab]);

  const build = useCallback((root: HTMLElement) => {
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialContentRef.current);
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          editable: () => true,
        }));
        ctx.update(remarkStringifyOptionsCtx, (prev) => ({
          ...prev,
          bullet: "-" as const,
        }));
        ctx.get(listenerCtx).markdownUpdated((_ctx, md) => {
          onChangeRef.current(normalizeMarkdown(md));
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(clipboard)
      .use(manifestoInlineMarks)
      .use(taskItemDraggable)
      .use(inlineCalculationsPlugin);
    const collabPlugin = collabFactoryRef.current;
    if (collabRef.current && collabPlugin) {
      editor.use(collabPlugin(collabRef.current));
    } else {
      editor.use(history);
    }
    return editor;
  }, []);

  // `@milkdown/plugin-listener` serializes the document on a 200ms debounce and
  // exposes no way to cancel it, so an editor torn down inside that window
  // leaves a timer that runs against a dismantled context and throws
  // `Context "editorView" not found` from a place nothing can catch. Its
  // handler checks `markdownUpdated.length` *before* it serializes, though, so
  // emptying the array is a cancel in everything but name: the timer still
  // fires, finds nothing to notify, and returns without touching the context.
  // Reachable whenever a note is closed within 200ms of a keystroke, and on
  // every solo → collab remount.
  const disarmListener = useCallback((instance: Editor) => {
    instance.action((ctx) => {
      const { listeners } = ctx.get(listenerCtx);
      listeners.markdownUpdated.length = 0;
      listeners.updated.length = 0;
    });
  }, []);

  const { editor, mountRef } = useMilkdownEditor(
    build,
    disarmListener,
    !collab || collabFactory !== null,
  );

  // A note that has never been edited collaboratively has an empty shared
  // fragment, and ySyncPlugin adopts whatever the fragment holds, so binding
  // would blank the editor and then write that blank back as the note content.
  // Seed the fragment from the note instead. Safe because NoteCardEditor only
  // supplies `collab` after the provider reports synced, so an empty fragment
  // here means the server has none either.
  useEffect(() => {
    if (!editor || !collab) return;
    const fragment = collab.ydoc.getXmlFragment(
      collab.fragmentName ?? DEFAULT_FRAGMENT_NAME,
    );
    if (fragment.length > 0) return;
    const initial = initialContentRef.current;
    if (initial.trim().length === 0) return;
    editor.action(replaceAll(initial));
  }, [editor, collab]);

  useEffect(() => {
    if (!editor) return;
    onEditorReadyRef.current?.(editor);
    if (autoFocus) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.focus();
        view.dispatch(
          view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
        );
      });
    }
  }, [editor, autoFocus]);

  useEffect(() => {
    if (!editor) return;
    const editable = !disabled && !contentLocked;
    editor.action((ctx) => {
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        editable: () => editable,
      }));
      const view = ctx.get(editorViewCtx);
      view.setProps({ editable: () => editable });
    });
  }, [editor, disabled, contentLocked]);

  // Carries the raw-mode content across a toggle. `null` until the first
  // toggle, which is how the effect below tells a real mode change from the
  // editor simply arriving: this effect's deps include `editor`, so it also
  // fires on the null → instance transition at mount, and its `else` branch
  // would then push the `content` prop into a document that was already built
  // from it. Harmless solo; in collab it overwrites the shared fragment that
  // ySyncPlugin has just rendered, with the note's real content replaced by
  // whatever this client happened to have, which is the data loss the seeding
  // effect above exists to avoid.
  const previousRawModeRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!editor) return;
    const toggled = previousRawModeRef.current !== null;
    previousRawModeRef.current = !!rawMode;
    if (!toggled) return;
    if (rawMode) {
      // The serializer ends every document with a newline, which in a
      // textarea is an empty last line under the text.
      const md = getEditorMarkdown(editor).replace(/\n+$/, "");
      setRawContent(md);
      rawContentRef.current = md;
    } else {
      // Read the latest textarea value, not whatever was captured when the
      // toggle effect was first scheduled; otherwise edits made in raw mode
      // are silently dropped on the way back to WYSIWYG.
      const latest = rawContentRef.current;
      editor.action(replaceAll(latest));
      onChangeRef.current(latest);
    }
  }, [rawMode, editor]);

  // The textarea grows with its text rather than scrolling inside the note,
  // which already scrolls. Sizing it by counting newlines, as `rows` did,
  // missed every line that wraps: a long paragraph pushed the first lines up
  // out of a box too short to hold it. Measured instead, and again whenever
  // the width changes, because narrowing the note wraps more lines. While
  // hidden it has no layout to measure, hence waiting for `rawMode`.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!rawMode || !textarea) return;
    const fitHeight = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    fitHeight();
    let width = textarea.clientWidth;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      fitHeight();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [rawMode, rawContent, textareaRef]);

  return (
    <>
      <textarea
        ref={textareaRef}
        class="block w-full py-1 bg-transparent outline-none resize-none overflow-hidden font-mono text-sm"
        style={{ display: rawMode ? "" : "none" }}
        rows={1}
        value={rawContent}
        onInput={(e) => {
          const val = (e.target as HTMLTextAreaElement).value;
          setRawContent(val);
          onChangeRef.current(val);
        }}
        disabled={disabled}
        readOnly={contentLocked}
      />
      <div
        ref={mountRef}
        class="milkdown-editor w-full outline-none text-sm"
        style={{ display: rawMode ? "none" : "" }}
      />
    </>
  );
}
