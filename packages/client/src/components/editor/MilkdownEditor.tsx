import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { gapCursorPlugin } from "@milkdown/kit/plugin/cursor";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
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
import { checklistBar } from "#/extensions/checklistBar.ts";
import { documentWatcher } from "#/extensions/documentWatcher.ts";
import { configureEditorKeys, editorKeys } from "#/extensions/editorKeys.ts";
import { inlineCalculationsPlugin } from "#/extensions/inlineCalculations.ts";
import { itemDatesPlugin } from "#/extensions/itemDates.ts";
import { linkTooltip } from "#/extensions/linkTooltip.ts";
import { manifestoInlineMarks } from "#/extensions/manifestoInlineMarks.ts";
import { tableBar } from "#/extensions/tableBar.ts";
import { taskItemDraggable } from "#/extensions/taskItemDraggable.ts";
import {
  DEFAULT_FRAGMENT_NAME,
  loadYjsCollab,
  type YjsCollabFactory,
} from "#/extensions/yjsCollab.ts";
import { useMilkdownEditor } from "#/hooks/useMilkdownEditor.ts";
import { t } from "#/i18n/index.ts";
import {
  normalizeMarkdown,
  replaceTextareaText,
} from "#/utils/editorMarkdown.ts";
import { rebaseEdit } from "#/utils/textMerge.ts";

/**
 * The document of the editor as markdown, normalized as `normalizeMarkdown`
 * says.
 */
export function getEditorMarkdown(editor: Editor): string {
  return normalizeMarkdown(editor.action(getMarkdown()));
}

interface MilkdownEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  disabled?: boolean | undefined;
  contentLocked?: boolean | undefined;
  rawMode?: boolean;
  /** Gets the raw-mode textarea. Thus, the toolbar can format its text. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  autoFocus?: boolean;
  onEditorReady?: (editor: Editor) => void;
  /** The editor that `onEditorReady` gave was destroyed. */
  onEditorGone?: () => void;
  collab?:
    | {
        ydoc: Y.Doc;
        fragmentName?: string;
        awareness?: import("y-protocols/awareness").Awareness | undefined;
      }
    | undefined;
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
  onEditorGone,
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
  const onEditorGoneRef = useRef(onEditorGone);
  onEditorGoneRef.current = onEditorGone;
  const initialContentRef = useRef(content);

  const [rawContent, setRawContent] = useState(content);
  const rawContentRef = useRef(rawContent);
  rawContentRef.current = rawContent;

  // The link of raw mode to the document, which is in the hidden rich editor
  // (and, in collab, in the shared fragment behind it). See the raw-mode effect
  // below.
  const rawSyncRef = useRef<{
    /** If the textarea is the element that you edit. */
    active: boolean;
    /** The text on which the textarea and the document agreed last. */
    base: string;
    /** The document with which `base` was agreed. */
    doc: ProseNode | null;
    /** The last value given to `onChange`, from either side. */
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
  // Assigned in the component body below. The plugins of the editor reach it
  // through this, because `build` runs one time and closes over nothing.
  const documentChangedRef = useRef<() => void>(() => {});

  const emitChange = (value: string) => {
    rawSyncRef.current.sent = value;
    onChangeRef.current(value);
  };
  const emitChangeRef = useRef(emitChange);
  emitChangeRef.current = emitChange;

  const collabRef = useRef(collab);
  collabRef.current = collab;

  // The collaborative plugin loads on demand. Thus, the code cannot build a
  // collaborative editor until it arrives. See `loadYjsCollab` for why the code
  // must have it *before* the editor is created, and must not await it inside
  // the plugin. It is also in a ref, because `build` reads it, but does not
  // take it as a dependency.
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
        // Leaves the editor not built, and does not make it silently
        // non-collaborative. A solo binding here would let the copy of this
        // client overwrite the shared document on the next save.
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
          // The editable area had no name. Thus, a screen reader announced an
          // unnamed text field after the title.
          attributes: {
            role: "textbox",
            "aria-multiline": "true",
            "aria-label": t("editor.contentLabel"),
          },
        }));
        configureEditorKeys(ctx);
        ctx.update(remarkStringifyOptionsCtx, (prev) => ({
          ...prev,
          bullet: "-" as const,
        }));
        ctx.get(listenerCtx).markdownUpdated((_ctx, md) => {
          const normalized = normalizeMarkdown(md);
          const sync = rawSyncRef.current;
          if (sync.active) {
            // In raw mode, the textarea reports the text, as typed. What still
            // comes through here is rich-mode typing that was inside the
            // debounce of the listener when raw mode opened. You can recognize
            // it as the text with which raw mode was loaded. Our own pushes
            // come back as the version of the textarea that the serializer
            // wrote again, and the code drops them.
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
      .use(editorKeys)
      .use(gapCursorPlugin)
      .use(itemDatesPlugin)
      .use(linkTooltip)
      .use(tableBar)
      .use(checklistBar)
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
   * Writes the text of the textarea into the rich editor, if it changed since
   * the two last agreed. In collab, that is also a write to the shared
   * fragment, which `ySyncPlugin` makes in the same call and as a diff. Thus,
   * only the parts that are different are replaced.
   *
   * But only what is different from the text as typed. An edit of a
   * collaborator that arrived since the last agreement, and did not reach the
   * textarea yet (the listener reports after a debounce), is not in that text,
   * and would be reverted. Thus, when the document moved, the code first
   * applies the local edit again on the version of the collaborator, and the
   * textarea gets the result. When the two edits change the same text, that is
   * not possible, and the local edit wins.
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

  // `@milkdown/plugin-listener` serializes the document after a 200ms debounce,
  // and gives no way to cancel it. Thus, an editor torn down inside that window
  // leaves a timer that runs against a removed context, and throws `Context
  // "editorView" not found` from a place where nothing can catch it. But its
  // handler checks `markdownUpdated.length` *before* it serializes. Thus, an
  // empty array is a cancel in all but name: the timer still fires, finds
  // nothing to notify, and returns without a change to the context. This can
  // occur each time a note closes within 200ms of a keystroke, and on each
  // remount from solo to collab.
  //
  // Raw text typed in the last frame is written after that, when the listener
  // cannot fire now. In collab, the provider can already be gone now (the
  // cleanup of a parent runs before that of its child). Thus, that write is
  // best effort. The pushes in each frame are what really carry raw edits out.
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
        // A document that is already torn down has no place to write.
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

  // A note that was never edited collaboratively has an empty shared fragment,
  // and ySyncPlugin adopts what the fragment contains. Thus, a binding would
  // make the editor blank, and then write that blank back as the content of the
  // note. Fill the fragment from the note in place of that. This is safe,
  // because NoteCardEditor gives `collab` only after the provider reports
  // synced. Thus, an empty fragment here means that the server also has none.
  //
  // A layout effect only to keep it before the raw-mode effect below, which
  // reads the text that this writes.
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

  // A parent that keeps the editor must release it after it is destroyed. Each
  // read of a destroyed editor throws (`Context "editorState" not found`), and
  // the parent continues to render when only this component is replaced, as on
  // the remount from solo to collab.
  useEffect(() => {
    if (!editor) return;
    return () => onEditorGoneRef.current?.();
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    onEditorReadyRef.current?.(editor);
    if (autoFocus && rawModeRef.current) {
      // The rich editor is hidden. If it had focus, the first keystrokes would
      // go into a document that nobody can see.
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
  // editor. The code keeps the two the same in both directions. It does not
  // reconcile them on the way out. If the textarea wrote over the full document
  // when you toggle back, work would be lost in collab. A note closed while
  // still in raw mode would never reach the shared fragment, and only a look at
  // a note in raw mode would overwrite what a collaborator wrote in the
  // meantime.
  //
  // - The start of raw mode reads the text out of the editor, never from the
  //   `content` prop, which in collab can be older than the shared fragment
  //   that the editor shows. The arrival counts as the start when the editor
  //   mounts directly into raw mode. But the end of raw mode only occurs after
  //   its start. Thus, an editor that arrives in rich mode never writes
  //   anything.
  // - Typing pushes the text into the editor one time in each frame
  //   (`pushRaw`). Thus, the document, and in collab all other persons, see raw
  //   edits while they occur, and nothing is left to write when the editor
  //   closes.
  // - A change to the document that is not the echo of our own push (an edit of
  //   a collaborator, or rich-mode typing still in the debounce of the listener
  //   when raw mode opened) is copied into the textarea, and the caret stays.
  //   If something typed there was not pushed yet, the push merges the two.
  // - While raw mode is on, the textarea feeds `onChange`. Thus, the saved text
  //   is the text as typed, not the version that the serializer wrote again.
  //
  // A layout effect. Thus, the start occurs in the same task as the commit that
  // removes the `readOnly` of the textarea. A passive effect runs one frame
  // later. A keystroke in that frame is not pushed (raw mode is not on yet),
  // and is then overwritten by the start, which reads the text out of the
  // editor.
  useLayoutEffect(() => {
    if (!editor) return;
    const sync = rawSyncRef.current;
    if (rawMode && !sync.active) {
      // The serializer ends each document with a newline. In a textarea, that
      // is an empty last line under the text.
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

  // The code must watch for the edits of collaborators directly. `ySyncPlugin`
  // applies them as `addToHistory: false` transactions, which the markdown
  // listener skips fully.
  documentChangedRef.current = () => {
    const sync = rawSyncRef.current;
    if (!editor || !sync.active || sync.pullFrame) return;
    sync.pullFrame = requestAnimationFrame(() => {
      sync.pullFrame = 0;
      if (!sync.active) return;
      const doc = editor.action((ctx) => ctx.get(editorViewCtx).state.doc);
      // Our own push, which recorded the document that it made.
      if (doc === sync.doc) return;
      // Typed, but not pushed yet: the push merges the two.
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

  // The textarea grows with its text, and does not scroll inside the note,
  // which already scrolls. When `rows` set its size from a count of newlines,
  // it missed each line that wraps. A long paragraph pushed the first lines up
  // out of a box that was too short. Thus, the code measures it, and measures
  // it again each time the width changes, because a narrower note wraps more
  // lines. While it is hidden, it has no layout to measure. Thus, the code
  // waits for `rawMode`.
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
        aria-label={t("editor.contentLabel")}
        rows={1}
        value={rawContent}
        onInput={(e) => onRawInput((e.target as HTMLTextAreaElement).value)}
        disabled={disabled}
        // Until the editor is up, there is no document from which to read the
        // text, or into which to push it. What shows is the `content` prop,
        // which the own text of the document replaces when it arrives.
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
