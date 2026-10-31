import { useState } from "preact/hooks";
import { useBackToClose } from "#/hooks/useBackToClose.ts";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import { askConfirmation } from "#/state/confirm.ts";
import { closeDrawing } from "#/state/drawing.ts";
import {
  hasStrokes,
  hasVisibleStrokes,
  type Sketch,
  type SketchHistory,
} from "#/utils/drawingLayers.ts";
import { encodeDrawing } from "#/utils/drawingRender.ts";

/**
 * How the pad ends: Done saves the picture, and a close (the button, Escape,
 * Back) asks first when there is a drawing to lose.
 */
export function usePadSession({
  onDone,
  canvasRef,
  overImage,
  historyRef,
  endInput,
}: {
  /** Called with the picture, an image file. Absent while no pad is open. */
  onDone: ((file: File) => void) | undefined;
  canvasRef: { readonly current: HTMLCanvasElement | null };
  /** If the pad opened with an image of the note. */
  overImage: () => boolean;
  historyRef: { readonly current: SketchHistory };
  /** Keeps a line, a selection or a polygon that is still in progress. */
  endInput: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * True when there is a drawing: on blank paper, as `drawn` says. Over an
   * image, any step from the start, because the image is a layer with ink.
   */
  const changed = (drawn: (sketch: Sketch) => boolean) =>
    overImage()
      ? historyRef.current.past.length > 0
      : drawn(historyRef.current.present);

  const discard = async () => {
    const confirmed = await askConfirmation({
      title: t("drawing.discardConfirm"),
      confirmLabel: t("drawing.discard"),
    });
    if (confirmed) closeDrawing();
  };

  /**
   * Closes the pad. It asks first when there is a drawing to lose. False when
   * it stays open to ask. That keeps Back for the pad in the meantime.
   */
  const cancel = (): boolean => {
    // A line that is still in progress is also a drawing to lose.
    endInput();
    if (!changed(hasStrokes)) {
      closeDrawing();
      return true;
    }
    void discard();
    return false;
  };

  useEscapeStack(true, () => {
    cancel();
  });
  useBackToClose(true, cancel);

  const done = () => {
    const canvas = canvasRef.current;
    if (!canvas || !onDone || saving) return;
    // Done, pushed with the pen still down, keeps the current line.
    endInput();
    // Only what shows is the picture. Hidden layers alone change nothing.
    if (!changed(hasVisibleStrokes)) {
      closeDrawing();
      return;
    }
    setSaving(true);
    setFailed(false);
    void encodeDrawing(canvas, overImage()).then((blob) => {
      if (!blob) {
        // The pad stays, with the drawing, for a new try. The message is here,
        // because a toast would be under the pad.
        setSaving(false);
        setFailed(true);
        return;
      }
      const name = t("drawing.fileName");
      onDone(
        new File(
          [blob],
          blob.type === "image/png" ? name : name.replace(/\.png$/, ".jpg"),
          { type: blob.type },
        ),
      );
      closeDrawing();
    });
  };

  return { cancel, done, saving, failed };
}
