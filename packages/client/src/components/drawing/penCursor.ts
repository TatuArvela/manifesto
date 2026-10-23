import type { PenTip } from "#/utils/drawing.ts";
import { tipStyle } from "./DrawingPen.tsx";

/**
 * The shape that the next stroke will fill, at the pointer, in the width and
 * the tip of the pen or the eraser as the paper shows it. Set on the element
 * itself: a render at each move of the pointer would cost a frame.
 *
 * `width` is in pixels of the paper, and `viewWidth` is the width of the part
 * of the paper that shows.
 */
export function placePenCursor(
  cursor: HTMLElement,
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  event: PointerEvent,
  pen: { tip: PenTip; width: number; viewWidth: number },
): void {
  const shown = canvas.getBoundingClientRect();
  const around = stage.getBoundingClientRect();
  const size = Math.max(4, (pen.width * shown.width) / pen.viewWidth);
  // The eraser has the tip of the pen too.
  const look = tipStyle(pen.tip, size);
  const height = Number.parseFloat(look.height);
  // The cursor is in the scrolled area, with the paper.
  const left = event.clientX - around.left + stage.scrollLeft - size / 2;
  const top = event.clientY - around.top + stage.scrollTop - height / 2;
  cursor.style.display = "block";
  cursor.style.width = look.width;
  cursor.style.height = look.height;
  cursor.style.borderRadius = look.borderRadius;
  cursor.style.transform = `translate(${left}px, ${top}px) ${look.transform ?? ""}`;
}
