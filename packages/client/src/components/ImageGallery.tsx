import { ChevronLeft, ChevronRight, X } from "lucide-preact";
import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { t } from "../i18n/index.js";
import { StoredImage } from "./StoredImage.js";

interface ImageGalleryProps {
  images: string[];
  onDelete?: (index: number) => void;
  /**
   * Fill the height of the parent, sharing it between the images and
   * cropping each to fit, instead of taking each image's own height: the
   * shape a square card needs when the images are all it holds.
   */
  fill?: boolean;
}

export function ImageGallery({ images, onDelete, fill }: ImageGalleryProps) {
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
                class={`w-full object-cover block ${fill ? "h-full" : "h-auto max-h-96"}`}
              />
            </button>
            {onDelete && (
              <button
                type="button"
                class="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover/img:opacity-100 focus-visible:opacity-100 hover:bg-black/80 transition-opacity cursor-pointer"
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
  const showPrev = () =>
    onChangeIndex((index - 1 + images.length) % images.length);
  const showNext = () => onChangeIndex((index + 1) % images.length);

  useEscapeStack(true, onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    if (!hasMultiple) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") showPrev();
      else if (e.key === "ArrowRight") showNext();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [hasMultiple, index, images.length]);

  return createPortal(
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
      <div
        class="fixed inset-0 bg-black/90 z-[100] animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("editor.imageViewer")}
        class="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none animate-fade-in"
      >
        <StoredImage
          src={images[index]}
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
