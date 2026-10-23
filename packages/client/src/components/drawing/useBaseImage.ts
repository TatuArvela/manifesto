import { isStoredImageRef } from "@manifesto/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "#/i18n/index.ts";
import { attachmentObjectUrl } from "#/state/attachments.ts";
import { closeDrawing } from "#/state/drawing.ts";
import { showError } from "#/state/ui.ts";
import { BLANK_PAPER, type PaperSize, paperSizeFor } from "#/utils/drawing.ts";

/**
 * The image to draw over, when the pad opened with one, and the paper in its
 * shape. Nothing is drawn until it is available: `ready` stays false. When it
 * cannot be read, the pad closes with a message.
 */
export function useBaseImage(baseSrc: string | undefined) {
  const base = useRef<HTMLImageElement | null>(null);
  const [paper, setPaper] = useState<PaperSize>(BLANK_PAPER);
  const [ready, setReady] = useState(baseSrc === undefined);

  useEffect(() => {
    if (baseSrc === undefined) return;
    let live = true;
    const fail = () => {
      if (!live) return;
      showError(t("drawing.openFailed"));
      closeDrawing();
    };
    const url = isStoredImageRef(baseSrc)
      ? attachmentObjectUrl(baseSrc)
      : Promise.resolve(baseSrc);
    void url.then((src) => {
      if (!live) return;
      if (src === null) {
        fail();
        return;
      }
      const image = new Image();
      image.onload = () => {
        if (!live) return;
        const size = paperSizeFor({
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        if (!size) {
          fail();
          return;
        }
        base.current = image;
        setPaper(size);
        setReady(true);
      };
      image.onerror = fail;
      image.src = src;
    });
    return () => {
      live = false;
    };
  }, [baseSrc]);

  return { base, paper, ready };
}
