import { isStoredImageRef } from "@manifesto/shared";
import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";
import { attachmentObjectUrl } from "#/state/attachments.ts";

/**
 * Gives each `<img data-image>` inside `root` the address of the image of the
 * note that it points to (see `utils/inlineImages.ts`), and the description
 * of that image as its `alt` when the text gave none. The rendered HTML is set
 * through `dangerouslySetInnerHTML`. Thus, this runs after each render, and
 * finds the images again in what the render put there.
 *
 * A pointer to an image that the note does not have (or does not have yet,
 * on a card from a list endpoint) stays an empty image with its `alt`.
 */
export function useInlineImages(
  root: RefObject<HTMLElement | null>,
  images: readonly string[] | undefined,
  alts?: readonly string[] | undefined,
): void {
  useEffect(() => {
    const element = root.current;
    if (!element || !images || images.length === 0) return;
    let live = true;
    for (const img of element.querySelectorAll<HTMLImageElement>(
      "img[data-image]",
    )) {
      const index = Number(img.dataset.image);
      const image = images[index];
      if (image === undefined) continue;
      const alt = alts?.[index];
      if (!img.getAttribute("alt") && alt) img.setAttribute("alt", alt);
      if (!isStoredImageRef(image)) {
        img.src = image;
        continue;
      }
      void attachmentObjectUrl(image).then((url) => {
        if (live && url) img.src = url;
      });
    }
    return () => {
      live = false;
    };
  });
}
