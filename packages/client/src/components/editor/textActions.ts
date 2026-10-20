import type { Editor } from "@milkdown/kit/core";
import { editorStateCtx, editorViewCtx } from "@milkdown/kit/core";
import type { Node } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { editorHistory } from "#/extensions/editorHistory.ts";
import { docHasDatedItems, sortItemsByDateIn } from "#/extensions/itemDates.ts";
import {
  deleteCheckedItemsIn,
  docHasCheckedItems,
  uncheckAllIn,
} from "#/extensions/taskListStructure.ts";
import { hasDatedItems, sortChecklistByDate } from "#/utils/itemDate.ts";
import {
  removeCheckedItems,
  hasCheckedItems as textHasCheckedItems,
  uncheckAllItems,
} from "#/utils/markdown.ts";
import { applyTextEdit } from "#/utils/rawFormatting.ts";

/**
 * What the toolbar and the menu of the editor do to the text of a note, against
 * the element that has it: the textarea in raw mode, and the rich editor
 * otherwise.
 *
 * Built on each render, not memoized. The tick of the editor schedules that
 * render (`useEditorTicks`). Thus, what this reads is as recent as the last
 * transaction.
 */
export interface TextActions {
  canUndo: boolean;
  canRedo: boolean;
  runHistory(which: "undo" | "redo"): void;
  checkedItems: { present: boolean; remove: () => void; uncheck: () => void };
  datedItems: { present: boolean; sort: () => void };
  focusText(at: "start" | "end"): void;
}

export function textActions(
  editor: Editor | null,
  rawMode: boolean,
  rawTextarea: HTMLTextAreaElement | null,
): TextActions {
  const readDoc = (read: (doc: Node) => boolean) =>
    editor ? editor.action((ctx) => read(ctx.get(editorStateCtx).doc)) : false;

  /** Writes the text again, and keeps the caret where it can stay. */
  const edit = (
    rewrite: (text: string) => string,
    inDoc: (view: EditorView) => void,
  ) => {
    if (rawTextarea) {
      const value = rewrite(rawTextarea.value);
      const caret = Math.min(rawTextarea.selectionStart, value.length);
      applyTextEdit(rawTextarea, {
        value,
        selectionStart: caret,
        selectionEnd: caret,
      });
      return;
    }
    editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      inDoc(view);
      view.focus();
    });
  };

  // The undo buttons control the history of the rich editor. In raw mode, that
  // history belongs to a document that will be replaced. Thus, they stop there.
  // The own undo of the textarea (Cmd+Z) covers raw edits, also those of the
  // toolbar. In collab, that history belongs to `yUndoPlugin`, not to Milkdown.
  // Thus, both go through `editorHistory`, which asks the state which one it
  // has.
  const canRun = (which: "undo" | "redo") =>
    editor && !rawMode
      ? editor.action((ctx) => {
          const state = ctx.get(editorStateCtx);
          return editorHistory(state)[which](state);
        })
      : false;

  return {
    canUndo: canRun("undo"),
    canRedo: canRun("redo"),
    runHistory: (which) =>
      editor?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        editorHistory(view.state)[which](view.state, view.dispatch);
      }),
    checkedItems: {
      present: rawTextarea
        ? textHasCheckedItems(rawTextarea.value)
        : readDoc(docHasCheckedItems),
      remove: () => edit(removeCheckedItems, deleteCheckedItemsIn),
      uncheck: () => edit(uncheckAllItems, uncheckAllIn),
    },
    datedItems: {
      present: rawTextarea
        ? hasDatedItems(rawTextarea.value)
        : readDoc(docHasDatedItems),
      sort: () => edit(sortChecklistByDate, sortItemsByDateIn),
    },
    focusText: (at) => {
      if (rawTextarea) {
        const pos = at === "start" ? 0 : rawTextarea.value.length;
        rawTextarea.focus();
        rawTextarea.setSelectionRange(pos, pos);
        return;
      }
      editor?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.focus();
        const { doc } = view.state;
        view.dispatch(
          view.state.tr.setSelection(
            at === "start"
              ? TextSelection.atStart(doc)
              : TextSelection.atEnd(doc),
          ),
        );
      });
    },
  };
}
