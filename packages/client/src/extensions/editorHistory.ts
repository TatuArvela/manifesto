import { redo, undo } from "@milkdown/kit/prose/history";
import { keymap } from "@milkdown/kit/prose/keymap";
import {
  type Command,
  type EditorState,
  Plugin,
  PluginKey,
} from "@milkdown/kit/prose/state";

/**
 * The undo and redo to which an editor answers. A solo editor keeps the
 * `history` of Milkdown (that of ProseMirror). A collaborative editor has
 * `yUndoPlugin` in its place, which undoes only the changes of this session,
 * and has no keymap of its own. Both are plain commands. Thus, when called
 * without `dispatch`, they tell if there is anything to undo. The toolbar
 * disables its buttons from that.
 */
export interface EditorHistory {
  undo: Command;
  redo: Command;
}

const editorHistoryKey = new PluginKey<EditorHistory>("editorHistory");

const proseHistory: EditorHistory = { undo, redo };

/**
 * The history with which this editor state was built: the collaborative history
 * when `editorHistoryPlugins` are installed, otherwise that of ProseMirror. The
 * code asks the state, not the code that built the editor. Thus, the toolbar
 * does not control a history plugin that is not there (it then reports nothing
 * to undo, and the buttons stay disabled forever).
 */
export function editorHistory(state: EditorState): EditorHistory {
  return editorHistoryKey.getState(state) ?? proseHistory;
}

/**
 * Installs a history that replaces the `history` plugin of Milkdown. It binds
 * the same keys, answers the own undo of the browser (the Edit menu, a shake on
 * iOS) in the same way, and makes the commands available through
 * `editorHistory`.
 */
export function editorHistoryPlugins(history: EditorHistory): Plugin[] {
  return [
    new Plugin({
      key: editorHistoryKey,
      state: { init: () => history, apply: (_tr, value) => value },
      props: {
        handleDOMEvents: {
          beforeinput(view, event) {
            const command =
              event.inputType === "historyUndo"
                ? history.undo
                : event.inputType === "historyRedo"
                  ? history.redo
                  : null;
            if (!command) return false;
            event.preventDefault();
            return command(view.state, view.dispatch);
          },
        },
      },
    }),
    keymap({
      "Mod-z": history.undo,
      "Mod-y": history.redo,
      "Shift-Mod-z": history.redo,
    }),
  ];
}
