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
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type * as Y from "yjs";
import { inlineCalculationsPlugin } from "../extensions/inlineCalculations.js";
import { manifestoInlineMarks } from "../extensions/manifestoInlineMarks.js";
import { taskItemDraggable } from "../extensions/taskItemDraggable.js";
import { yjsCollab } from "../extensions/yjsCollab.js";
import { useMilkdownEditor } from "../hooks/useMilkdownEditor.js";

/** prosemirror-markdown escapes `[` `]` per CommonMark; our content uses literal
 * brackets (e.g. "Post [ ] Maa"), so we unescape them on readout. */
function unescapeBrackets(md: string): string {
  return md.replace(/\\([[\]])/g, "$1");
}

const LIST_LINE_RE = /^\s*(?:[-*+] |\d+[.)] )/;

/** mdast's "spread" lists insert blank lines between items on stringify. Our
 * preview treats each blank line as a segment gap, which balloons a simple
 * checklist into disconnected blocks. Collapse blank lines that only sit
 * between two list items. */
function collapseListSpread(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "" && out.length > 0) {
      const prev = out[out.length - 1];
      let j = i;
      while (j < lines.length && lines[j].trim() === "") j++;
      const next = lines[j] ?? "";
      if (LIST_LINE_RE.test(prev) && LIST_LINE_RE.test(next)) {
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

function normalizeMarkdown(md: string): string {
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
  autoFocus,
  onEditorReady,
  collab,
}: MilkdownEditorProps) {
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
    if (collabRef.current) {
      // y-prosemirror's yUndoPlugin replaces the standard history plugin —
      // mixing the two double-applies undo on remote operations.
      editor.use(yjsCollab(collabRef.current));
    } else {
      editor.use(history);
    }
    return editor;
  }, []);

  const { editor, mountRef } = useMilkdownEditor(build);

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

  useEffect(() => {
    if (!editor) return;
    if (rawMode) {
      const md = getEditorMarkdown(editor);
      setRawContent(md);
      rawContentRef.current = md;
    } else {
      // Read the latest textarea value, not whatever was captured when the
      // toggle effect was first scheduled — otherwise edits made in raw mode
      // are silently dropped on the way back to WYSIWYG.
      const latest = rawContentRef.current;
      editor.action(replaceAll(latest));
      onChangeRef.current(latest);
    }
  }, [rawMode, editor]);

  const rawRows = Math.max(5, rawContent.split("\n").length);

  return (
    <>
      <textarea
        class="w-full p-2 bg-transparent outline-none resize-none font-mono text-sm"
        style={{ display: rawMode ? "" : "none" }}
        rows={rawRows}
        value={rawContent}
        onInput={(e) => {
          const val = (e.target as HTMLTextAreaElement).value;
          setRawContent(val);
          onChangeRef.current(val);
        }}
        disabled={disabled}
      />
      <div
        ref={mountRef}
        class="milkdown-editor w-full outline-none text-sm"
        style={{ display: rawMode ? "none" : "" }}
      />
    </>
  );
}
