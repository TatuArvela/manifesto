import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { t } from "#/i18n/index.ts";
import {
  applyTableAction,
  availableTableActions,
  type TableAction,
} from "./tableActions.ts";

/**
 * A bar of row and column buttons over the table the caret is in, where the
 * eye already is. It holds what the toolbar's Table menu holds; that menu is
 * the keyboard's way to the same changes, since Tab stays in the table.
 *
 * Every button is always there, a change that does not apply disabled rather
 * than taken away, so the bar keeps its shape and a button is where it was.
 */

const svg = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const PLUS = svg(`<path d="M5 12h14"/><path d="M12 5v14"/>`);
const MINUS = svg(`<path d="M5 12h14"/>`);
const TRASH = svg(
  `<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
);

/** Each button: its icon, its short text (none for the bin), its full name. */
const BUTTONS: [TableAction, string, () => string, () => string][] = [
  [
    "addRowAfter",
    PLUS,
    () => t("format.tableRow"),
    () => t("format.tableAddRow"),
  ],
  [
    "addColumnAfter",
    PLUS,
    () => t("format.tableColumn"),
    () => t("format.tableAddColumn"),
  ],
  [
    "deleteRow",
    MINUS,
    () => t("format.tableRow"),
    () => t("format.tableDeleteRow"),
  ],
  [
    "deleteColumn",
    MINUS,
    () => t("format.tableColumn"),
    () => t("format.tableDeleteColumn"),
  ],
  ["deleteTable", TRASH, () => "", () => t("format.tableDelete")],
];

/** The gap between the bar and the table's edge, in pixels. */
const GAP = 6;

class TableBarView {
  private readonly el: HTMLDivElement;
  private readonly buttons = new Map<
    TableAction,
    { button: HTMLButtonElement; text: HTMLSpanElement }
  >();

  constructor(private readonly view: EditorView) {
    this.el = document.createElement("div");
    this.el.className = "table-bar";
    this.el.dataset.open = "false";
    this.el.setAttribute("role", "toolbar");
    for (const [action, icon] of BUTTONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "table-bar-button";
      button.innerHTML = icon;
      const text = document.createElement("span");
      button.append(text);
      // Keeps the caret, and so the bar, in the table.
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => {
        applyTableAction(this.view.state, action, this.view.dispatch);
      });
      this.buttons.set(action, { button, text });
      // Rules between adding, removing a row or column, and removing it all.
      if (action === "deleteRow" || action === "deleteTable") {
        const rule = document.createElement("span");
        rule.className = "table-bar-rule";
        rule.setAttribute("aria-hidden", "true");
        this.el.append(rule);
      }
      this.el.append(button);
    }
    this.host()?.append(this.el);
    this.update();
  }

  /** The editor's root, which is positioned and scrolls with the note. */
  private host(): HTMLElement | null {
    return this.view.dom.closest<HTMLElement>(".milkdown-editor");
  }

  /** The DOM of the table the selection is in, if any. */
  private table(): HTMLElement | null {
    const { $from } = this.view.state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name !== "table") continue;
      const dom = this.view.nodeDOM($from.before(depth));
      return dom instanceof HTMLElement ? dom : null;
    }
    return null;
  }

  update() {
    const host = this.host();
    const table =
      this.view.hasFocus() && this.view.editable ? this.table() : null;
    if (!table || !host) {
      this.hide();
      return;
    }
    if (!this.el.isConnected) host.append(this.el);

    const available = availableTableActions(this.view.state);
    for (const [action, , text, label] of BUTTONS) {
      const entry = this.buttons.get(action);
      if (!entry) continue;
      entry.text.textContent = text();
      entry.button.setAttribute("aria-label", label());
      entry.button.title = label();
      entry.button.disabled = !available.includes(action);
    }

    // Above the table, or under it when the note has no room above (a table
    // at the very top), where the bar would be cut off by the note's edge.
    const box = host.getBoundingClientRect();
    const rect = table.getBoundingClientRect();
    const height = this.el.offsetHeight;
    const above = rect.top - box.top - height - GAP;
    const top = above >= 0 ? above : rect.bottom - box.top + GAP;
    const widest = Math.max(0, host.clientWidth - this.el.offsetWidth);
    this.el.style.left = `${Math.min(widest, Math.max(0, rect.left - box.left))}px`;
    this.el.style.top = `${top}px`;
    this.el.dataset.open = "true";
  }

  /** Fades out where it is, rather than jumping away first. */
  hide() {
    this.el.dataset.open = "false";
  }

  destroy() {
    this.el.remove();
  }
}

const views = new WeakMap<EditorView, TableBarView>();

const tableBarPlugin = new Plugin({
  view(view) {
    const bar = new TableBarView(view);
    views.set(view, bar);
    // A wide table scrolls sideways inside the text, and the bar with it.
    const onScroll = () => bar.update();
    view.dom.addEventListener("scroll", onScroll, { passive: true });
    return {
      update: () => bar.update(),
      destroy: () => {
        view.dom.removeEventListener("scroll", onScroll);
        bar.destroy();
        views.delete(view);
      },
    };
  },
  props: {
    handleDOMEvents: {
      focus: (view) => {
        views.get(view)?.update();
        return false;
      },
      blur: (view) => {
        views.get(view)?.hide();
        return false;
      },
    },
  },
});

export const tableBar: MilkdownPlugin = (ctx) => () => {
  ctx.update(prosePluginsCtx, (plugins) => [...plugins, tableBarPlugin]);
};
