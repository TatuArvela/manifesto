import { redo, undo } from "@milkdown/kit/prose/history";
import { keymap } from "@milkdown/kit/prose/keymap";
import {
  type Command,
  type EditorState,
  Plugin,
  PluginKey,
} from "@milkdown/kit/prose/state";

/**
 * The undo and redo an editor answers to. A solo editor keeps Milkdown's
 * `history` (ProseMirror's own); a collaborative one has `yUndoPlugin` in its
 * place, which undoes only this session's changes and has no keymap of its
 * own. Both are plain commands, so called without `dispatch` they say whether
 * there is anything to undo, which is what the toolbar disables its buttons on.
 */
export interface EditorHistory {
  undo: Command;
  redo: Command;
}

const editorHistoryKey = new PluginKey<EditorHistory>("editorHistory");

const proseHistory: EditorHistory = { undo, redo };

/**
 * The history this editor state was built with: the collaborative one when
 * `editorHistoryPlugin` is installed, ProseMirror's otherwise. Asking the
 * state, rather than whoever built the editor, keeps the toolbar from driving
 * a history plugin that is not there (it then reports nothing to undo, and
 * the buttons stay disabled for good).
 */
export function editorHistory(state: EditorState): EditorHistory {
  return editorHistoryKey.getState(state) ?? proseHistory;
}

/**
 * Installs a history that replaces Milkdown's `history` plugin: binds the
 * same keys it does, answers the browser's own undo (the Edit menu, a shake on
 * iOS) as it does, and makes the commands reachable through `editorHistory`.
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
