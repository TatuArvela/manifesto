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
 * The image node of the editor. A pointer to an image of the note
 * (`image:N`, see `utils/inlineImages.ts`) gets its address from the resolver.
 * The browser cannot load the pointer itself. All other images keep their own
 * `src`, as in the preset.
 */
export const inlineImageView = (resolve: InlineImageResolver) =>
  $view(imageSchema.node, () => (initial) => {
    const dom = document.createElement("img");
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
      dom,
      update: (node) => {
        if (node.type !== initial.type) return false;
        show(node);
        return true;
      },
    };
  });
