import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { type EditorState, Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { t } from "#/i18n/index.ts";
import { inlineCalculations, resolvedDecimalSeparator } from "#/state/prefs.ts";
import {
  evaluateExpression,
  formatResult,
} from "#/utils/evaluateExpression.ts";

type CalcState =
  | { active: false; dismissedAt: number | null }
  | {
      active: true;
      pos: number;
      formatted: string;
      dismissedAt: number | null;
    };

const inlineCalcKey = new PluginKey<CalcState>("manifestoInlineCalculations");

function isInCodeContext(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "code_block") return true;
  }
  if ($from.marks().some((m) => m.type.name === "code")) return true;
  return false;
}

function computeState(
  state: EditorState,
  dismissedAt: number | null,
): CalcState {
  if (!inlineCalculations.value) return { active: false, dismissedAt: null };
  const { selection } = state;
  if (!selection.empty) return { active: false, dismissedAt };
  const { $from } = selection;
  if ($from.parent.type.name !== "paragraph")
    return { active: false, dismissedAt };
  if (isInCodeContext(state)) return { active: false, dismissedAt };

  const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
  if (!textBefore.endsWith("=")) return { active: false, dismissedAt };

  // Do not show the preview if the user already typed something after the "="
  // that the cursor moved past. Only show it when "=" is the character
  // immediately before the cursor.
  const remaining = $from.parent.textContent.slice($from.parentOffset);
  if (remaining.length > 0 && remaining[0] !== "\n") {
    // There is something after the cursor on this line. Thus, skip.
    return { active: false, dismissedAt };
  }

  const decimal = resolvedDecimalSeparator();
  const match = evaluateExpression(textBefore, decimal);
  if (!match) return { active: false, dismissedAt };

  const pos = $from.pos;
  // Obey a previous dismissal by Escape at the same position, until the user
  // moves or edits.
  if (dismissedAt === pos) return { active: false, dismissedAt };

  return {
    active: true,
    pos,
    formatted: formatResult(match.result, decimal),
    dismissedAt: null,
  };
}

function renderWidget(formatted: string) {
  return () => {
    const el = document.createElement("span");
    el.className = "inline-calc-preview";
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("contenteditable", "false");
    el.textContent = formatted;
    return el;
  };
}

const calcPlugin = new Plugin<CalcState>({
  key: inlineCalcKey,
  state: {
    init: (_config, state) => computeState(state, null),
    apply: (tr, old, _oldState, newState) => {
      const meta = tr.getMeta(inlineCalcKey) as
        | { type: "dismiss"; pos: number }
        | undefined;
      let dismissedAt = old.dismissedAt;
      if (meta?.type === "dismiss") {
        dismissedAt = meta.pos;
      } else if (tr.docChanged) {
        // Each change of the document cancels a dismissal.
        dismissedAt = null;
      }
      if (!tr.docChanged && !tr.selectionSet && meta === undefined) {
        return old;
      }
      return computeState(newState, dismissedAt);
    },
  },
  // The result is drawn as a widget inside the text. A screen reader must not
  // read it as part of the text (`aria-hidden` above). Thus, a polite live
  // region next to the editor announces it: one time when it shows or changes,
  // and not again when the caret moves along the same line.
  view(editorView) {
    const status = document.createElement("span");
    status.className = "sr-only";
    status.setAttribute("role", "status");
    editorView.dom.parentElement?.appendChild(status);
    let said = "";
    const announce = (state: EditorState) => {
      const s = inlineCalcKey.getState(state);
      const text = s?.active
        ? t("editor.calcResult", { result: s.formatted })
        : "";
      if (text === said) return;
      said = text;
      status.textContent = text;
    };
    announce(editorView.state);
    return {
      update: (view) => announce(view.state),
      destroy: () => status.remove(),
    };
  },
  props: {
    decorations(state) {
      const s = inlineCalcKey.getState(state);
      if (!s?.active) return null;
      return DecorationSet.create(state.doc, [
        Decoration.widget(s.pos, renderWidget(s.formatted), {
          side: 1,
          key: `inline-calc:${s.formatted}`,
          ignoreSelection: true,
        }),
      ]);
    },
    handleKeyDown(view, event) {
      const s = inlineCalcKey.getState(view.state);
      if (!s?.active) return false;
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        const tr = view.state.tr.insertText(s.formatted, s.pos);
        view.dispatch(tr);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        const tr = view.state.tr.setMeta(inlineCalcKey, {
          type: "dismiss",
          pos: s.pos,
        });
        view.dispatch(tr);
        return true;
      }
      return false;
    },
  },
});

export const inlineCalculationsPlugin: MilkdownPlugin = (ctx) => () => {
  ctx.update(prosePluginsCtx, (plugins) => [...plugins, calcPlugin]);
};
