import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { t } from "#/i18n/index.ts";
import { itemDateOf, setItemDate } from "./itemDates.ts";
import { activeTaskItem } from "./taskListStructure.ts";

/**
 * A bar over the checklist item the caret is in, as the table has one over
 * its table. It dates the item: the date button opens the browser's own date
 * picker, and the pick is written into the item as an `@2026-10-02` token
 * (see `itemDates.ts`), which stays plain text a keyboard can type, change
 * or delete as well.
 */

const svg = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const CALENDAR = svg(
  `<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>`,
);

/** The gap between the bar and the item's line, in pixels. */
const GAP = 4;

class ChecklistBarView {
  readonly el: HTMLDivElement;
  private readonly dateButton: HTMLButtonElement;
  private readonly picker: HTMLInputElement;

  constructor(private readonly view: EditorView) {
    this.el = document.createElement("div");
    this.el.className = "table-bar checklist-bar";
    this.el.dataset.open = "false";
    this.el.setAttribute("role", "toolbar");

    this.dateButton = document.createElement("button");
    this.dateButton.type = "button";
    this.dateButton.className = "table-bar-button";
    this.dateButton.innerHTML = CALENDAR;
    // Keeps the caret, and so the bar, in the item.
    this.dateButton.addEventListener("mousedown", (e) => e.preventDefault());
    this.dateButton.addEventListener("click", () => this.openPicker());

    // The picker's input sits under the date button, unseen: the browser
    // anchors its calendar to it, and it is how a browser without
    // `showPicker` is asked to open one.
    this.picker = document.createElement("input");
    this.picker.type = "date";
    this.picker.className = "checklist-bar-picker";
    this.picker.tabIndex = -1;
    this.picker.setAttribute("aria-hidden", "true");
    this.picker.addEventListener("change", () => {
      if (this.picker.value === "") return;
      setItemDate(this.view.state, this.picker.value, this.view.dispatch);
      this.view.focus();
    });
    // Closing the picker without a pick, by focusing anything but the text.
    this.picker.addEventListener("blur", (e) => {
      if (e.relatedTarget !== this.view.dom) this.hide();
    });

    this.el.append(this.picker, this.dateButton);
    this.host()?.append(this.el);
    this.update();
  }

  private openPicker() {
    const item = activeTaskItem(this.view.state);
    if (!item) return;
    // An undated item starts the picker empty, not on today: a pick that
    // leaves the value as it was fires no `change`, so today could not be
    // chosen. The calendar opens on the current month either way.
    this.picker.value = itemDateOf(item.node)?.date ?? "";
    try {
      this.picker.showPicker();
    } catch {
      // No `showPicker`, or it refused: focusing the input opens the
      // picker where the browser has no other way to it.
      this.picker.focus();
    }
  }

  /** The editor's root, which is positioned and scrolls with the note. */
  private host(): HTMLElement | null {
    return this.view.dom.closest<HTMLElement>(".milkdown-editor");
  }

  /** The item's own line: its first paragraph, not the items inside it. */
  private line(pos: number): HTMLElement | null {
    const dom = this.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return null;
    return dom.querySelector<HTMLElement>(
      ":scope > .task-item-content > :first-child",
    );
  }

  update() {
    const host = this.host();
    const item =
      this.view.hasFocus() && this.view.editable
        ? activeTaskItem(this.view.state)
        : null;
    const line = item ? this.line(item.pos) : null;
    const row = line?.closest<HTMLElement>("li");
    if (!item || !line || !row || !host) {
      this.hide();
      return;
    }
    if (!this.el.isConnected) host.append(this.el);

    // The icon alone on screen; the name says whether it adds or changes.
    const label = itemDateOf(item.node)
      ? t("editor.itemDateChange")
      : t("editor.itemDate");
    this.dateButton.setAttribute("aria-label", label);
    this.dateButton.title = label;

    // Above the item's line at its right end, where a short item leaves the
    // row above clear; under the line when the note has no room above it.
    const box = host.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const height = this.el.offsetHeight;
    const above = lineRect.top - box.top - height - GAP;
    const top = above >= 0 ? above : lineRect.bottom - box.top + GAP;
    const right = rowRect.right - box.left;
    const left = Math.max(0, right - this.el.offsetWidth);
    this.el.style.left = `${left}px`;
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

const views = new WeakMap<EditorView, ChecklistBarView>();

const checklistBarPlugin = new Plugin({
  view(view) {
    const bar = new ChecklistBarView(view);
    views.set(view, bar);
    return {
      update: () => bar.update(),
      destroy: () => {
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
      blur: (view, event) => {
        const bar = views.get(view);
        // Focus going to the picker (where it is opened by focusing it) is
        // still the bar at work.
        const to = (event as FocusEvent).relatedTarget;
        if (to instanceof Node && bar?.el.contains(to)) return false;
        bar?.hide();
        return false;
      },
    },
  },
});

export const checklistBar: MilkdownPlugin = (ctx) => () => {
  ctx.update(prosePluginsCtx, (plugins) => [...plugins, checklistBarPlugin]);
};
