// Where a drawing goes in the images of a note. Apart from the drawing code:
// the editor needs these two on the board, and the pad loads only when it
// opens. If they were in `drawing.ts`, all of its render code would be in the
// entry chunk.

import { carriedImageAlts, type Note } from "@manifesto/shared";

/**
 * The images of a note with `added` put in: in place of `replaces` where the
 * note still has it, and at the end otherwise. Thus, a drawing made over an
 * image that was removed in the meantime is kept, not dropped.
 */
export function placeImages(
  images: readonly string[],
  added: readonly string[],
  replaces?: string,
): string[] {
  if (replaces === undefined || !images.includes(replaces)) {
    return [...images, ...added];
  }
  return images.flatMap((image) => (image === replaces ? added : [image]));
}

/**
 * The descriptions for the answer of `placeImages`. Each image keeps its own,
 * and a drawing made over an image takes the description of that image, which
 * still tells what is under the lines. Empty when no image has one.
 */
export function placedImageAlts(
  before: Pick<Note, "images" | "imageAlts">,
  placed: readonly string[],
  added: readonly string[],
  replaces?: string,
): string[] {
  const alts = carriedImageAlts(before, placed);
  const under =
    replaces === undefined
      ? ""
      : (before.imageAlts?.[before.images.indexOf(replaces)] ?? "");
  if (!under) return alts;
  return placed.map((image, i) =>
    added.includes(image) ? under : (alts[i] ?? ""),
  );
}
