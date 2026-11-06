import { imageSchema } from "@milkdown/kit/preset/commonmark";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { $view } from "@milkdown/kit/utils";
import { pointedImage } from "#/utils/inlineImages.ts";

/**
 * Gives the address that shows image `index` (from 0) of the note, or null
 * when the note does not have it. `MilkdownEditor` gives it from the images
 * of the note.
 */
export type InlineImageResolver = (
  index: number,
) => Promise<{ src: string; alt: string } | null>;

/**
 * Draws the buttons over an image of the note in the text (the same buttons as
 * in the header of the note) into `container`. `NoteEditor` gives it. This
 * folder cannot import components.
 */
export interface InlineImageControls {
  /**
   * Draws the buttons of image `index` (from 0). Called again on a change.
   * `reload` gets the address again. Call it when the list of images changes:
   * the same pointer can then name a different image.
   */
  show: (container: HTMLElement, index: number, reload: () => void) => void;
  /** Takes them down, when the image goes or stops being a pointer. */
  hide: (container: HTMLElement) => void;
}

/**
 * The image node of the editor. A pointer to an image of the note
 * (`image:N`, see `utils/inlineImages.ts`) gets its address from the resolver,
 * and the buttons of the image from `controls`. The browser cannot load the
 * pointer itself. All other images keep their own `src`, as in the preset, and
 * have no buttons, because they are not images of the note.
 */
export const inlineImageView = (
  resolve: InlineImageResolver,
  controls: () => InlineImageControls | undefined,
) =>
  $view(imageSchema.node, () => (initial) => {
    // A frame for the buttons, which are over the image. ProseMirror makes a
    // leaf node not editable. Thus, the buttons can take focus and clicks.
    const frame = document.createElement("span");
    frame.className = "relative inline-block max-w-full align-bottom group/img";
    const dom = document.createElement("img");
    const buttons = document.createElement("span");
    // A press must not move the caret, or select the image.
    buttons.addEventListener("mousedown", (e) => e.preventDefault());
    frame.append(dom, buttons);
    let shown = false;
    const reload = () => {
      const node = current;
      current = null;
      if (node) show(node);
    };
    const showButtons = (index: number | null) => {
      const drawer = controls();
      if (!drawer) return;
      if (index === null) {
        if (shown) drawer.hide(buttons);
        shown = false;
        return;
      }
      drawer.show(buttons, index, reload);
      shown = true;
    };
    let current: ProseNode | null = null;
    const show = (node: ProseNode) => {
      if (current?.sameMarkup(node)) return;
      current = node;
      const src = String(node.attrs.src ?? "");
      const alt = String(node.attrs.alt ?? "");
      const title = String(node.attrs.title ?? "");
      dom.alt = alt;
      if (title) dom.title = title;
      else dom.removeAttribute("title");
      const index = pointedImage(src);
      showButtons(index);
      if (index === null) {
        dom.removeAttribute("data-image");
        dom.src = src;
        return;
      }
      dom.dataset.image = String(index);
      dom.removeAttribute("src");
      void resolve(index).then((found) => {
        if (current !== node || !found) return;
        dom.src = found.src;
        if (!alt) dom.alt = found.alt;
      });
    };
    show(initial);
    return {
      dom: frame,
      update: (node) => {
        if (node.type !== initial.type) return false;
        show(node);
        return true;
      },
      // The buttons are not part of the document. ProseMirror must not
      // handle their events, or draw the node again when they change.
      stopEvent: (event) => buttons.contains(event.target as Node | null),
      ignoreMutation: () => true,
      destroy: () => showButtons(null),
    };
  });
