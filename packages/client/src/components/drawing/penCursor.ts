import type { PenTip } from "#/utils/drawing.ts";
import { tipStyle } from "./DrawingPen.tsx";

/**
 * The shape that the next stroke will fill, at the pointer, in the width and
 * the tip of the pen or the eraser as the paper shows it. Set on the element
 * itself: a render at each move of the pointer would cost a frame.
 *
 * `width` is in pixels of the paper, and `scale` is the CSS pixels of the
 * screen for each of them.
 */
export function placePenCursor(
  cursor: HTMLElement,
  stage: HTMLElement,
  event: PointerEvent,
  pen: { tip: PenTip; width: number; scale: number },
): void {
  const around = stage.getBoundingClientRect();
  const size = Math.max(4, pen.width * pen.scale);
  // The eraser has the tip of the pen too.
  const look = tipStyle(pen.tip, size);
  const height = Number.parseFloat(look.height);
  const left = event.clientX - around.left - size / 2;
  const top = event.clientY - around.top - height / 2;
  cursor.style.display = "block";
  cursor.style.width = look.width;
  cursor.style.height = look.height;
  cursor.style.borderRadius = look.borderRadius;
  cursor.style.transform = `translate(${left}px, ${top}px) ${look.transform ?? ""}`;
}
