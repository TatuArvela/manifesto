import { prosePluginsCtx } from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { keymap } from "@milkdown/kit/prose/keymap";
import { type EditorState, Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { t } from "../i18n/index.js";

/**
 * Links in the editor. A click places the caret, as it does on any other text,
 * instead of leaving the note for the link's target; and while the caret is on
 * a link, an "Open link" button sits under it for when leaving is the point.
 * Mod-Enter does the same from the keyboard.
 *
 * Only web and mail addresses are opened. A link's target is whatever the
 * markdown says, and a `javascript:` one would otherwise run in the app.
 */

const OPENABLE = /^(?:https?:|mailto:)/i;

const EXTERNAL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;

interface LinkAtCaret {
  href: string;
  /** Document position where the link's text starts. */
  from: number;
}

/** The link the (collapsed) selection sits in, if it can be opened. */
export function linkAtCaret(state: EditorState): LinkAtCaret | null {
  const linkType = state.schema.marks.link;
  const { selection } = state;
  if (!linkType || !selection.empty) return null;
  const { $from } = selection;
  const mark = linkType.isInSet($from.marks());
  if (!mark) return null;
  const href = String(mark.attrs.href ?? "");
  if (!OPENABLE.test(href)) return null;

  // Walk back through the parent's children for where this link's run of
  // text begins, so the button sits under the start of the link rather than
  // wherever the caret happens to be.
  const parent = $from.parent;
  let offset = 0;
  let runStart = -1;
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const inLink = mark.isInSet(child.marks);
    if (inLink && runStart === -1) runStart = offset;
    if (!inLink) runStart = -1;
    offset += child.nodeSize;
    if (offset >= $from.parentOffset && runStart !== -1) break;
  }
  return { href, from: $from.start() + Math.max(0, runStart) };
}

function openLink(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}

class LinkTooltipView {
  private readonly el: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private href: string | null = null;

  constructor(private readonly view: EditorView) {
    this.el = document.createElement("div");
    this.el.className = "link-tooltip";
    this.el.dataset.open = "false";
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.innerHTML = EXTERNAL_ICON;
    this.label = document.createElement("span");
    this.button.append(this.label);
    // Keeps the caret, and so the tooltip, where it is.
    this.button.addEventListener("mousedown", (e) => e.preventDefault());
    this.button.addEventListener("click", () => {
      if (this.href) openLink(this.href);
    });
    this.el.append(this.button);
    this.host()?.append(this.el);
    this.update();
  }

  /** The editor's root, which is positioned and scrolls with the note. */
  private host(): HTMLElement | null {
    return this.view.dom.closest<HTMLElement>(".milkdown-editor");
  }

  update() {
    const link = this.view.hasFocus() ? linkAtCaret(this.view.state) : null;
    const host = this.host();
    if (!link || !host) {
      this.hide();
      return;
    }
    if (!this.el.isConnected) host.append(this.el);
    this.href = link.href;
    this.label.textContent = t("editor.openLink");
    this.button.title = link.href;
    const start = this.view.coordsAtPos(link.from);
    const box = host.getBoundingClientRect();
    this.el.style.left = `${Math.max(0, start.left - box.left)}px`;
    this.el.style.top = `${start.bottom - box.top + 6}px`;
    this.el.dataset.open = "true";
  }

  /** Fades out where it is, rather than jumping away first. */
  hide() {
    this.href = null;
    this.el.dataset.open = "false";
  }

  destroy() {
    this.el.remove();
  }
}

const views = new WeakMap<EditorView, LinkTooltipView>();

const linkTooltipPlugin = new Plugin({
  view(view) {
    const tooltip = new LinkTooltipView(view);
    views.set(view, tooltip);
    return {
      update: () => tooltip.update(),
      destroy: () => {
        tooltip.destroy();
        views.delete(view);
      },
    };
  },
  props: {
    handleDOMEvents: {
      click: (_view, event) => {
        // A link is text to put the caret in while editing; the button is
        // how to follow it.
        if ((event.target as Element | null)?.closest?.("a")) {
          event.preventDefault();
        }
        return false;
      },
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

const openLinkKeymap = keymap({
  "Mod-Enter": (state) => {
    const link = linkAtCaret(state);
    if (!link) return false;
    openLink(link.href);
    return true;
  },
});

export const linkTooltip: MilkdownPlugin = (ctx) => () => {
  ctx.update(prosePluginsCtx, (plugins) => [
    ...plugins,
    linkTooltipPlugin,
    openLinkKeymap,
  ]);
};
