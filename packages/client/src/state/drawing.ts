import { signal } from "@preact/signals";

/**
 * The drawing pad, when one is open, and what to do with the picture it
 * makes. One for the whole app, asked for by whichever editor is open and
 * rendered by `App` beside its other dialogs rather than inside the editor:
 * an open note is laid out in the page on a phone, and a layer over it has to
 * be a sibling of the app shell, as the confirmation is.
 */
export const drawingRequest = signal<{
  /** Called with the finished drawing, a PNG. */
  onDone: (file: File) => void;
} | null>(null);

export function requestDrawing(onDone: (file: File) => void): void {
  drawingRequest.value = { onDone };
}

export function closeDrawing(): void {
  drawingRequest.value = null;
}
