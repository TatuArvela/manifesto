/** A rectangle in the own CSS pixels of a host, from its top left corner. */
export interface HostRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Where a rectangle on the screen (`getBoundingClientRect`, `coordsAtPos`) is
 * inside `host`, in the pixels in which an element positioned in the host is
 * placed.
 *
 * Not the plain difference of the two screen rectangles. The panel of an open
 * note grows out of its card with a scale (`utils/morph.ts`), and the editor
 * places its bars when it gets focus, while the panel is still scaled down. A
 * distance on the screen was then shorter than the same distance in the host,
 * and a bar stayed at approximately half of its height in the note after the
 * grow.
 */
export function rectInHost(
  host: HTMLElement,
  rect: { top: number; bottom: number; left: number; right: number },
): HostRect {
  const box = host.getBoundingClientRect();
  const scaleX =
    host.offsetWidth > 0 && box.width > 0 ? box.width / host.offsetWidth : 1;
  const scaleY =
    host.offsetHeight > 0 && box.height > 0
      ? box.height / host.offsetHeight
      : 1;
  return {
    top: (rect.top - box.top) / scaleY,
    bottom: (rect.bottom - box.top) / scaleY,
    left: (rect.left - box.left) / scaleX,
    right: (rect.right - box.left) / scaleX,
  };
}
