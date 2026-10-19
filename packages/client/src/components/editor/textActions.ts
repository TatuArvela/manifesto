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
 * What the editor's toolbar and menu do to a note's text, against whichever
 * holds it: the textarea in raw mode, the rich editor otherwise.
 *
 * Built on every render rather than memoised: the editor's tick is what
 * schedules that render (`useEditorTicks`), so what this reads is as fresh as
 * the last transaction.
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

  /** Rewrites the text, keeping the caret where it can stay. */
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

  // The undo buttons drive the rich editor's history, which in raw mode
  // belongs to a document that is about to be replaced, so they stand down
  // there; the textarea's own undo (Cmd+Z) covers raw edits, toolbar ones
  // included. In collab that history is `yUndoPlugin`'s, not Milkdown's, so
  // both go through `editorHistory`, which asks the state which one it has.
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
