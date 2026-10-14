import { ChevronLeft, ChevronRight, PenLine, X } from "lucide-preact";
import { createPortal } from "preact";
import { useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { t } from "../i18n/index.js";
import { Backdrop } from "./Backdrop.js";
import { StoredImage } from "./StoredImage.js";

interface ImageGalleryProps {
  images: string[];
  onDelete?: (index: number) => void;
  /** Opens the image on the drawing pad; left out where it cannot change. */
  onEdit?: ((index: number) => void) | undefined;
  /**
   * Fill the height of the parent, sharing it between the images and
   * cropping each to fit, instead of taking each image's own height: the
   * shape a square card needs when the images are all it holds.
   */
  fill?: boolean;
}

/**
 * A button over an image in the editor: out of the way until the image is
 * pointed at or the button focused, and always there on a touch screen, which
 * has no pointer to bring it out.
 */
const imageButtonClass =
  "absolute bottom-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover/img:opacity-100 focus-visible:opacity-100 touch:opacity-100 hover:bg-black/80 transition-opacity cursor-pointer";

export function ImageGallery({
  images,
  onDelete,
  onEdit,
  fill,
}: ImageGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <div class={`flex flex-col ${fill ? "h-full" : ""}`}>
        {images.map((src, i) => (
          <div
            key={`${i}-${src.slice(0, 48)}`}
            class={`relative group/img bg-black/5 dark:bg-white/5 ${fill ? "flex-1 min-h-0" : ""}`}
          >
            <button
              type="button"
              class={`block w-full cursor-zoom-in ${fill ? "h-full" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setOpenIndex(i);
              }}
              aria-label={t("editor.openImage")}
            >
              <StoredImage
                src={src}
                alt=""
                draggable={false}
                class={`w-full object-cover block ${fill ? "h-full" : "h-auto max-h-96"}`}
              />
            </button>
            {onEdit && (
              <button
                type="button"
                class={`${onDelete ? "right-11" : "right-2"} ${imageButtonClass}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(i);
                }}
                aria-label={t("editor.drawOnImage")}
              >
                <PenLine class="w-4 h-4" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                class={`right-2 ${imageButtonClass}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(i);
                }}
                aria-label={t("editor.imageAlt")}
              >
                <X class="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {openIndex !== null && (
        <ImageLightbox
          images={images}
          index={openIndex}
          onChangeIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
}

function ImageLightbox({
  images,
  index,
  onChangeIndex,
  onClose,
}: {
  images: string[];
  index: number;
  onChangeIndex: (i: number) => void;
  onClose: () => void;
}) {
  const hasMultiple = images.length > 1;
  const step = (by: number) =>
    onChangeIndex((index + by + images.length) % images.length);
  const showPrev = () => step(-1);
  const showNext = () => step(1);

  useEscapeStack(true, onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  // On the dialog, which holds the focus (`useFocusTrap`), rather than on the
  // document: the arrows are this layer's, and never anything under it.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!hasMultiple || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const by = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (by === 0) return;
    e.preventDefault();
    step(by);
  };

  const shown = images[index];
  if (shown === undefined) return null;

  return createPortal(
    <>
      <Backdrop onDismiss={onClose} class="layer-gallery-backdrop" deep />
      <div
        ref={dialogRef}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={t("editor.imageViewer")}
        class="fixed inset-0 layer-gallery flex items-center justify-center p-4 pointer-events-none animate-fade-in"
      >
        <StoredImage
          src={shown}
          alt=""
          class="pointer-events-auto max-h-full max-w-full object-contain select-none"
        />
        <button
          type="button"
          class="pointer-events-auto absolute top-4 right-4 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 cursor-pointer"
          onClick={onClose}
          aria-label={t("editor.closeImage")}
        >
          <X class="w-5 h-5" />
        </button>
        {hasMultiple && (
          <>
            <button
              type="button"
              class="pointer-events-auto absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                showPrev();
              }}
              aria-label={t("editor.previousImage")}
            >
              <ChevronLeft class="w-6 h-6" />
            </button>
            <button
              type="button"
              class="pointer-events-auto absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                showNext();
              }}
              aria-label={t("editor.nextImage")}
            >
              <ChevronRight class="w-6 h-6" />
            </button>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
