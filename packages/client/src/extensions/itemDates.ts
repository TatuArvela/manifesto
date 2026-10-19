import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Transaction,
} from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import {
  findItemDate,
  itemDateClass,
  localIsoDate,
  UNDATED,
} from "#/utils/itemDate.ts";
import {
  activeTaskItem,
  isTaskItem,
  sortListItems,
} from "./taskListStructure.ts";

// Dates on checklist items in the editor (see `utils/itemDate.ts`). The token
// stays ordinary text in the item, so the schema is untouched; a decoration
// draws it as the chip the card shows.

/**
 * The date token in a task item's own text, with its offsets from the item's
 * position, or null. Text marked as code is quoted, and an item nested in
 * this one answers for itself.
 */
export function itemDateOf(
  item: ProseNode,
): { date: string; from: number; to: number } | null {
  const label = item.firstChild;
  if (label?.type.name !== "paragraph") return null;
  let found: { date: string; from: number; to: number } | null = null;
  label.forEach((child, offset) => {
    if (found || !child.isText) return;
    if (child.marks.some((mark) => mark.type.spec.code === true)) return;
    const token = findItemDate(child.text ?? "");
    if (!token) return;
    // +1 into the item, +1 into its paragraph.
    const base = 2 + offset;
    found = {
      date: token.date,
      from: base + token.start,
      to: base + token.end,
    };
  });
  return found;
}

function chips(doc: ProseNode): DecorationSet {
  const today = localIsoDate(new Date());
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!isTaskItem(node)) return true;
    const found = itemDateOf(node);
    if (found) {
      decorations.push(
        Decoration.inline(pos + found.from, pos + found.to, {
          class: itemDateClass(found.date, node.attrs.checked === true, today),
        }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

const itemDatesKey = new PluginKey<DecorationSet>("manifestoItemDates");

const chipPlugin = new Plugin<DecorationSet>({
  key: itemDatesKey,
  state: {
    init: (_config, state) => chips(state.doc),
    // Ticking an item changes the document too, so this is the only trigger.
    apply: (tr, old) => (tr.docChanged ? chips(tr.doc) : old),
  },
  props: {
    decorations: (state) => itemDatesKey.getState(state),
  },
});

export const itemDatesPlugin: MilkdownPlugin = (ctx) => () => {
  ctx.update(prosePluginsCtx, (plugins) => [...plugins, chipPlugin]);
};

/** Whether the document holds a dated checklist item. */
export function docHasDatedItems(doc: ProseNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (isTaskItem(node) && itemDateOf(node)) found = true;
    return !found;
  });
  return found;
}

/**
 * Puts the checklist items of the editor's document in date order, each among
 * its siblings, as `sortChecklistByDate` does for Markdown.
 */
export function sortItemsByDateIn(view: EditorView): void {
  const { tr } = view.state;
  const sorted = sortListItems(
    tr,
    (child) =>
      (isTaskItem(child) ? itemDateOf(child)?.date : undefined) ?? UNDATED,
  );
  if (sorted) view.dispatch(tr);
}

/**
 * Gives the checklist item around the caret the date `date` (`YYYY-MM-DD`),
 * in place of any it had. A new token goes at the end of the item's own line,
 * a space from its text, and carries no mark from beside it: a code mark would
 * quote it, and it would no longer be a date.
 */
export function setItemDate(
  state: EditorState,
  date: string,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const item = activeTaskItem(state);
  const label = item?.node.firstChild;
  if (!item || label?.type.name !== "paragraph") return false;
  if (findItemDate(`@${date}`)?.date !== date) return false;
  if (!dispatch) return true;

  const { tr } = state;
  const found = itemDateOf(item.node);
  if (found) {
    tr.replaceWith(
      item.pos + found.from,
      item.pos + found.to,
      state.schema.text(`@${date}`),
    );
  } else {
    // +1 into the item, +1 into its paragraph.
    const end = item.pos + 2 + label.content.size;
    const text = label.textContent;
    const space = text === "" || /\s$/.test(text) ? "" : " ";
    tr.insert(end, state.schema.text(`${space}@${date}`));
  }
  dispatch(tr.scrollIntoView());
  return true;
}
