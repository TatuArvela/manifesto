// An image in the text of a note is a pointer to one of the images of that
// note: `![](image:2)` is the second image of `Note.images`. The bytes, the
// keys and the description stay with the image list. Thus, sealing, the sweep
// of attachments and the export need no change. An export keeps the order of
// the list, so the pointers still hold after an import.
//
// The number counts from 1. When an image goes, `withoutImagePointer` changes
// the text with it: pointers to that image go, and later pointers move down.

const POINTER_SRC = /^image:(\d{1,3})$/;
const POINTER_IN_TEXT = /!\[([^\]\n]{0,500})\]\(image:(\d{1,3})\)/g;

/** The `src` of a pointer to image `index` (from 1). */
export function imagePointer(index: number): string {
  return `image:${index}`;
}

/** The index (from 0) in `Note.images` that `src` names, or null. */
export function pointedImage(src: string): number | null {
  const [, digits] = POINTER_SRC.exec(src) ?? [];
  const index = Number(digits);
  return digits && index >= 1 ? index - 1 : null;
}

/**
 * The images (from 0) that `content` shows. The header of the note leaves them
 * out: an image is in the header or in the text, not in both.
 */
export function imagesInText(content: string): ReadonlySet<number> {
  const shown = new Set<number>();
  if (!content.includes("](image:")) return shown;
  for (const [, , digits] of content.matchAll(POINTER_IN_TEXT)) {
    const index = Number(digits) - 1;
    if (index >= 0) shown.add(index);
  }
  return shown;
}

/** How many of `count` images the header shows, after `imagesInText`. */
export function headerImageCount(count: number, content: string): number {
  let inText = 0;
  for (const index of imagesInText(content)) if (index < count) inText++;
  return count - inText;
}

/**
 * `content` after the image at `removed` (from 0) left the note. Each pointer
 * to it goes. Each pointer to a later image moves down by one. With `renumber`
 * false, the image stays in the note and only leaves the text (back to the
 * header). Then the other pointers keep their numbers.
 */
export function withoutImagePointer(
  content: string,
  removed: number,
  renumber = true,
): string {
  if (!content.includes("](image:")) return content;
  return content.replace(POINTER_IN_TEXT, (whole, alt: string, digits) => {
    const index = Number(digits) - 1;
    if (index === removed) return "";
    if (renumber && index > removed) return `![${alt}](${imagePointer(index)})`;
    return whole;
  });
}

/** As much of a hast node as `markImagePointers` reads and writes. */
interface HtmlNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
}

function markPointers(node: HtmlNode): void {
  for (const child of node.children ?? []) {
    const src = child.properties?.src;
    if (child.tagName === "img" && typeof src === "string") {
      const index = pointedImage(src);
      if (index !== null && child.properties) {
        delete child.properties.src;
        child.properties.dataImage = String(index);
      }
    }
    markPointers(child);
  }
}

/**
 * A rehype step: each `<img src="image:N">` becomes `<img data-image="N-1">`
 * with no `src`. The sanitizer would drop the unknown scheme, and the browser
 * cannot load it. `fillInlineImages` gives it the real address in the view.
 */
export function markImagePointers() {
  return (tree: HtmlNode) => markPointers(tree);
}
