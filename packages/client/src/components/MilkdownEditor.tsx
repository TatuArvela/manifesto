import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  prosePluginsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
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
import { linkTooltip } from "../extensions/linkTooltip.js";
import { manifestoInlineMarks } from "../extensions/manifestoInlineMarks.js";
import { taskItemDraggable } from "../extensions/taskItemDraggable.js";
import {
  DEFAULT_FRAGMENT_NAME,
  loadYjsCollab,
  type YjsCollabFactory,
} from "../extensions/yjsCollab.js";
import { useMilkdownEditor } from "../hooks/useMilkdownEditor.js";
import { markFencedLines } from "../utils/markdown.js";
import { rebaseEdit } from "../utils/textMerge.js";

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

/**
 * Calls `onChange` after every transaction that changes the document, whatever
 * its origin, including the ones the markdown listener ignores.
 */
function documentWatcher(onChange: () => void): MilkdownPlugin {
  return (ctx) => () => {
    ctx.update(prosePluginsCtx, (plugins) => [
      ...plugins,
      new Plugin({
        view: () => ({
          update: (view, prevState) => {
            if (view.state.doc !== prevState.doc) onChange();
          },
        }),
      }),
    ]);
  };
}

/**
 * Replaces a textarea's text with a change made elsewhere, keeping the caret
 * on the same text: before the change it stays put, after it moves with it.
 */
function replaceTextareaText(
  textarea: HTMLTextAreaElement | null,
  next: string,
): void {
  if (!textarea) return;
  const old = textarea.value;
  const focused = document.activeElement === textarea;
  const { selectionStart, selectionEnd } = textarea;
  let prefix = 0;
  const max = Math.min(old.length, next.length);
  while (prefix < max && old[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    old[old.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  const map = (pos: number) =>
    pos <= prefix
      ? pos
      : pos >= old.length - suffix
        ? pos + next.length - old.length
        : next.length - suffix;
  textarea.value = next;
  if (focused)
    textarea.setSelectionRange(map(selectionStart), map(selectionEnd));
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
  const rawModeRef = useRef(rawMode);
  rawModeRef.current = rawMode;
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

  // Raw mode's link to the document, which lives in the hidden rich editor
  // (and, in collab, in the shared fragment behind it). See the raw-mode
  // effect further down.
  const rawSyncRef = useRef<{
    /** Whether the textarea is the one being edited. */
    active: boolean;
    /** The text the textarea and the document last agreed on. */
    base: string;
    /** The document `base` was agreed with. */
    doc: ProseNode | null;
    /** The last value handed to `onChange`, from either side. */
    sent: string;
    frame: number;
    pullFrame: number;
  }>({
    active: false,
    base: "",
    doc: null,
    sent: content,
    frame: 0,
    pullFrame: 0,
  });
  // Assigned in the component body below; the editor's plugins reach it
  // through this because `build` runs once and closes over nothing.
  const documentChangedRef = useRef<() => void>(() => {});

  const emitChange = (value: string) => {
    rawSyncRef.current.sent = value;
    onChangeRef.current(value);
  };
  const emitChangeRef = useRef(emitChange);
  emitChangeRef.current = emitChange;

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
          const normalized = normalizeMarkdown(md);
          const sync = rawSyncRef.current;
          if (sync.active) {
            // In raw mode the textarea reports the text, as typed. What still
            // comes through here is rich-mode typing that was inside the
            // listener's debounce when raw mode opened, recognisable as the
            // text raw mode was loaded with; our own pushes echo back as the
            // serializer's rewrite of the textarea, and are dropped.
            const text = normalized.replace(/\n+$/, "");
            if (text !== sync.base || text === sync.sent.replace(/\n+$/, "")) {
              return;
            }
          }
          emitChangeRef.current(normalized);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(clipboard)
      .use(manifestoInlineMarks)
      .use(taskItemDraggable)
      .use(inlineCalculationsPlugin)
      .use(linkTooltip)
      .use(documentWatcher(() => documentChangedRef.current()));
    const collabPlugin = collabFactoryRef.current;
    if (collabRef.current && collabPlugin) {
      editor.use(collabPlugin(collabRef.current));
    } else {
      editor.use(history);
    }
    return editor;
  }, []);

  /**
   * Writes the textarea's text into the rich editor, if it has changed since
   * the two last agreed. In collab that is also a write to the shared
   * fragment, which `ySyncPlugin` makes in the same call and as a diff, so
   * only what differs is replaced.
   *
   * Only what differs from the text as typed, though: a collaborator's edit
   * that landed since the last agreement, and has not reached the textarea
   * yet (the listener reports on a debounce), is not in that text and would
   * be reverted. So when the document has moved, the local edit is replayed
   * onto the collaborator's version first, and the textarea takes the result.
   * When the two edits touch the same text that cannot be done, and the local
   * one wins.
   */
  const pushRaw = useCallback(
    (instance: Editor) => {
      const sync = rawSyncRef.current;
      cancelAnimationFrame(sync.frame);
      sync.frame = 0;
      let text = rawContentRef.current;
      if (text === sync.base) return;
      const viewDoc = () =>
        instance.action((ctx) => ctx.get(editorViewCtx).state.doc);
      if (sync.doc !== null && viewDoc() !== sync.doc) {
        const theirs = getEditorMarkdown(instance).replace(/\n+$/, "");
        const merged = rebaseEdit(sync.base, text, theirs);
        if (merged !== null && merged !== text) {
          text = merged;
          replaceTextareaText(textareaRef.current, merged);
          rawContentRef.current = merged;
          setRawContent(merged);
          emitChangeRef.current(merged);
        }
      }
      sync.base = text;
      instance.action(replaceAll(text));
      sync.doc = viewDoc();
    },
    [textareaRef],
  );

  // `@milkdown/plugin-listener` serializes the document on a 200ms debounce and
  // exposes no way to cancel it, so an editor torn down inside that window
  // leaves a timer that runs against a dismantled context and throws
  // `Context "editorView" not found` from a place nothing can catch. Its
  // handler checks `markdownUpdated.length` *before* it serializes, though, so
  // emptying the array is a cancel in everything but name: the timer still
  // fires, finds nothing to notify, and returns without touching the context.
  // Reachable whenever a note is closed within 200ms of a keystroke, and on
  // every solo → collab remount.
  //
  // Raw text typed in the last frame is written through afterwards, once the
  // listener can no longer fire. In collab the provider may already be gone by
  // now (a parent's cleanup runs before its child's), so that write is best
  // effort; the per-frame pushes are what actually carry raw edits out.
  const beforeDestroy = useCallback(
    (instance: Editor) => {
      instance.action((ctx) => {
        const { listeners } = ctx.get(listenerCtx);
        listeners.markdownUpdated.length = 0;
        listeners.updated.length = 0;
      });
      const sync = rawSyncRef.current;
      if (!sync.active) return;
      cancelAnimationFrame(sync.pullFrame);
      try {
        pushRaw(instance);
      } catch {
        // A document already torn down beneath us has nowhere to write.
      }
      sync.active = false;
    },
    [pushRaw],
  );

  const { editor, mountRef } = useMilkdownEditor(
    build,
    beforeDestroy,
    !collab || collabFactory !== null,
  );

  // A note that has never been edited collaboratively has an empty shared
  // fragment, and ySyncPlugin adopts whatever the fragment holds, so binding
  // would blank the editor and then write that blank back as the note content.
  // Seed the fragment from the note instead. Safe because NoteCardEditor only
  // supplies `collab` after the provider reports synced, so an empty fragment
  // here means the server has none either.
  //
  // A layout effect only to keep it ahead of the raw-mode one below, which
  // reads the text this writes.
  useLayoutEffect(() => {
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
    if (autoFocus && rawModeRef.current) {
      // The rich editor is hidden: focusing it would send the first
      // keystrokes into a document nobody can see.
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    } else if (autoFocus) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.focus();
        view.dispatch(
          view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
        );
      });
    }
  }, [editor, autoFocus, textareaRef]);

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

  // Raw mode edits the note as text while the document stays in the rich
  // editor, and the two are kept in step both ways rather than reconciled on
  // the way out. They used to be reconciled on toggling back, by writing the
  // textarea over the whole document, which in collab had two ways to lose
  // work: a note closed while still in raw mode never reached the shared
  // fragment at all, so its next opening showed, and saved, the text from
  // before; and merely looking at a note in raw mode overwrote whatever a
  // collaborator had written meanwhile.
  //
  // - Entering reads the text out of the editor, never from the `content`
  //   prop, which in collab can be staler than the shared fragment the editor
  //   is showing. Arriving counts as entering when the editor mounts straight
  //   into raw mode, but leaving only happens after entering, so the editor
  //   arriving in rich mode never writes anything.
  // - Typing pushes the text into the editor once per frame (`pushRaw`), so
  //   the document, and in collab everyone else, sees raw edits as they are
  //   made, and nothing is left to write when the editor closes.
  // - A change to the document that is not our own push's echo (a
  //   collaborator's edit, or rich-mode typing still in the listener's
  //   debounce when raw mode opened) is copied into the textarea, keeping the
  //   caret. If something typed there has yet to be pushed, the push merges
  //   the two instead.
  // - `onChange` is fed from the textarea while raw mode is on, so what is
  //   saved is the text as typed, not the serializer's rewrite of it.
  //
  // A layout effect, so entering happens in the same task as the commit that
  // lifts the textarea's `readOnly`. As a passive effect it ran a frame later,
  // and a keystroke in that frame was not pushed (raw mode was not on yet) and
  // then overwritten by entering, which reads the text out of the editor.
  useLayoutEffect(() => {
    if (!editor) return;
    const sync = rawSyncRef.current;
    if (rawMode && !sync.active) {
      // The serializer ends every document with a newline, which in a
      // textarea is an empty last line under the text.
      const text = getEditorMarkdown(editor).replace(/\n+$/, "");
      sync.active = true;
      sync.base = text;
      sync.doc = editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
      rawContentRef.current = text;
      setRawContent(text);
    } else if (!rawMode && sync.active) {
      cancelAnimationFrame(sync.pullFrame);
      sync.pullFrame = 0;
      pushRaw(editor);
      sync.active = false;
    }
  }, [rawMode, editor, pushRaw]);

  // Collaborators' edits have to be watched for directly: `ySyncPlugin`
  // applies them as `addToHistory: false` transactions, which the markdown
  // listener skips entirely.
  documentChangedRef.current = () => {
    const sync = rawSyncRef.current;
    if (!editor || !sync.active || sync.pullFrame) return;
    sync.pullFrame = requestAnimationFrame(() => {
      sync.pullFrame = 0;
      if (!sync.active) return;
      const doc = editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
      // Our own push, which recorded the document it produced.
      if (doc === sync.doc) return;
      // Typed but not yet pushed: the push merges the two.
      if (rawContentRef.current !== sync.base) return;
      const md = getEditorMarkdown(editor);
      const text = md.replace(/\n+$/, "");
      sync.doc = doc;
      if (text === sync.base) return;
      sync.base = text;
      replaceTextareaText(textareaRef.current, text);
      rawContentRef.current = text;
      setRawContent(text);
      emitChange(md);
    });
  };

  const onRawInput = (value: string) => {
    rawContentRef.current = value;
    setRawContent(value);
    emitChange(value);
    const sync = rawSyncRef.current;
    if (!editor || !sync.active || sync.frame) return;
    sync.frame = requestAnimationFrame(() => {
      sync.frame = 0;
      pushRaw(editor);
    });
  };

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
        class="block w-full py-1 bg-transparent outline-none resize-none overflow-hidden font-mono text-sm max-sm:text-[16px]/6"
        style={{ display: rawMode ? "" : "none" }}
        rows={1}
        value={rawContent}
        onInput={(e) => onRawInput((e.target as HTMLTextAreaElement).value)}
        disabled={disabled}
        // Until the editor is up there is no document to read the text out of
        // or push it into: what shows is the `content` prop, which is replaced
        // by the document's own text the moment it arrives.
        readOnly={contentLocked || !editor}
      />
      <div
        ref={mountRef}
        class="milkdown-editor w-full outline-none text-sm max-sm:text-[16px]/6"
        style={{ display: rawMode ? "none" : "" }}
      />
    </>
  );
}
