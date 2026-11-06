import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import { imagePointer, pointedImage } from "#/utils/inlineImages.ts";

/**
 * The document after the image at `removed` (from 0) left the note, as
 * `withoutImagePointer` does for the Markdown. Each image node that points to
 * it goes. Each pointer to a later image moves down by one. A transaction of
 * the editor, not a new text. Thus, the change also reaches the shared
 * document of a collaborative note, and the caret stays where it was. With
 * `renumber` false, the image only leaves the text, as in `withoutImagePointer`.
 */
export function removeImagePointers(
  state: EditorState,
  removed: number,
  renumber = true,
): Transaction | null {
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "image") return true;
    const index = pointedImage(String(node.attrs.src ?? ""));
    if (index === null || index < removed) return false;
    const at = tr.mapping.map(pos);
    if (index === removed) tr.delete(at, at + node.nodeSize);
    else if (renumber)
      tr.setNodeMarkup(at, undefined, {
        ...node.attrs,
        src: imagePointer(index),
      });
    return false;
  });
  return tr.docChanged ? tr : null;
}

/**
 * Puts a pointer to image `index` (from 0) of the note at `pos`, a position
 * that a click found. Between two blocks, the image gets a paragraph of its
 * own.
 */
export function placeImagePointer(
  state: EditorState,
  pos: number,
  index: number,
): Transaction | null {
  const image = state.schema.nodes.image;
  if (!image) return null;
  return state.tr
    .replaceRangeWith(pos, pos, image.create({ src: imagePointer(index + 1) }))
    .scrollIntoView();
}
