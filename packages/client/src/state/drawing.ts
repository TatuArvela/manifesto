import { signal } from "@preact/signals";

/**
 * The drawing pad, when one is open, and what to do with the picture that it
 * makes. One for the full app. The open editor asks for it, and `App` renders
 * it next to its other dialogs, not inside the editor. On a phone, an open note
 * is part of the page layout, and a layer over it must be a sibling of the app
 * shell, as the confirmation is.
 */
export const drawingRequest = signal<{
  /** Called with the completed drawing, an image file. */
  onDone: (file: File) => void;
  /** One of the images of the note to draw over, as the note has it. */
  base?: string | undefined;
} | null>(null);

export function requestDrawing(
  onDone: (file: File) => void,
  base?: string,
): void {
  drawingRequest.value = { onDone, base };
}

export function closeDrawing(): void {
  drawingRequest.value = null;
}
