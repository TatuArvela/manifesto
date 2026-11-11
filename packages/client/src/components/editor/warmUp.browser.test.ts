import { afterEach, describe, expect, it } from "vitest";
import { drawingRequest } from "#/state/drawing.ts";
import { editorWasBuilt } from "./makeNoteEditor.ts";
import { warmUpEditor } from "./warmUp.ts";

/** Resolves in a task after the next paint. */
function afterPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );
}

/** A paste of a picture, which the paste handler of an open editor takes. */
function pastePicture(): ClipboardEvent {
  const data = new DataTransfer();
  data.items.add(
    new File([new Uint8Array([1])], "dot.png", { type: "image/png" }),
  );
  const paste = new ClipboardEvent("paste", {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(paste);
  return paste;
}

afterEach(() => {
  drawingRequest.value = null;
});

// The tests run in order: the first warm-up of the file is the one that
// builds, and later ones see `editorWasBuilt`.
describe("the warm-up of the editor", () => {
  // Each editor closes the drawing pad when it unmounts. The warm-up must not
  // close a pad that a person has open.
  it("does nothing while a drawing pad is open", async () => {
    const request = { onDone: () => {} };
    drawingRequest.value = request;
    await warmUpEditor();
    expect(drawingRequest.value).toBe(request);
    expect(editorWasBuilt()).toBe(false);
  });

  // It renders a full editor where nobody sees it, in one task. Thus, no
  // effect of it runs, and nothing of it stays: not on the page, and not as
  // a listener on the document.
  it("builds an editor, and leaves nothing behind", async () => {
    const before = document.body.innerHTML;
    await warmUpEditor();
    expect(editorWasBuilt()).toBe(true);
    expect(document.body.innerHTML).toBe(before);

    await afterPaint();
    await afterPaint();
    expect(pastePicture().defaultPrevented).toBe(false);
  });
});
