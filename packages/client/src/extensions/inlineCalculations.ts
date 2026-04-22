import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { type EditorState, Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import {
  inlineCalculations,
  resolvedDecimalSeparator,
} from "../state/prefs.js";
import {
  evaluateExpression,
  formatResult,
} from "../utils/evaluateExpression.js";

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

  // Don't show the preview if the user already typed something after the "="
  // that the cursor has moved past — only light up when "=" is the char
  // immediately before the cursor.
  const remaining = $from.parent.textContent.slice($from.parentOffset);
  if (remaining.length > 0 && remaining[0] !== "\n") {
    // Something's there after the cursor on this line — skip.
    return { active: false, dismissedAt };
  }

  const decimal = resolvedDecimalSeparator();
  const match = evaluateExpression(textBefore, decimal);
  if (!match) return { active: false, dismissedAt };

  const pos = $from.pos;
  // Respect a previous Escape-dismissal at the same position until the user moves or edits.
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
        // Any doc change invalidates a dismissal.
        dismissedAt = null;
      }
      if (!tr.docChanged && !tr.selectionSet && meta === undefined) {
        return old;
      }
      return computeState(newState, dismissedAt);
    },
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
