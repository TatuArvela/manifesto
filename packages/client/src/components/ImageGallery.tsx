import { MAX_IMAGE_ALT_LENGTH } from "@manifesto/shared";
import { Captions, ChevronLeft, ChevronRight, PenLine, X } from "lucide-preact";
import { createPortal } from "preact";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useFocusTrap } from "#/hooks/useFocusTrap.ts";
import { t } from "#/i18n/index.ts";
import { Backdrop } from "./Backdrop.tsx";
import { StoredImage } from "./StoredImage.tsx";

interface ImageGalleryProps {
  images: string[];
  /** What each image shows, in words, aligned with `images`: its `alt`. */
  alts?: string[] | undefined;
  /**
   * Gives an image its description. Not given where it cannot change. The code
   * names the image by its reference, not its position, because a different
   * writer can have moved it before this write completes.
   */
  onDescribe?: ((image: string, alt: string) => void) | undefined;
  onDelete?: (index: number) => void;
  /** Opens the image on the drawing pad. Not given where it cannot change. */
  onEdit?: ((index: number) => void) | undefined;
  /**
   * Fill the height of the parent, shared between the images, and crop each
   * image to fit. Do not use the own height of each image. A square card needs
   * this shape when it contains only the images.
   */
  fill?: boolean;
}

/**
 * A button over an image in the editor. It stays hidden until the pointer is on
 * the image or the button has focus. It always shows on a touch screen, which
 * has no pointer to show it.
 */
const imageButtonClass =
  "absolute bottom-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover/img:opacity-100 focus-visible:opacity-100 touch:opacity-100 hover:bg-black/80 transition-opacity cursor-pointer";

export function ImageGallery({
  images,
  alts,
  onDescribe,
  onDelete,
  onEdit,
  fill,
}: ImageGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Opened from "Describe image", which goes directly to the field.
  const [describing, setDescribing] = useState(false);
  const open = (index: number, describe: boolean) => {
    setDescribing(describe);
    setOpenIndex(index);
  };

  if (images.length === 0) return null;
  const altOf = (i: number) => alts?.[i] ?? "";
  // The buttons over an image are from right to left: delete, draw, describe.
  const buttonsRight = ["right-2", "right-11", "right-20"];
  let nextButton = 0;
  const deleteAt = onDelete ? buttonsRight[nextButton++] : undefined;
  const editAt = onEdit ? buttonsRight[nextButton++] : undefined;
  const describeAt = onDescribe ? buttonsRight[nextButton++] : undefined;

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
                open(i, false);
              }}
              aria-label={
                altOf(i)
                  ? t("editor.openImageNamed", { description: altOf(i) })
                  : t("editor.openImage")
              }
            >
              <StoredImage
                src={src}
                alt={altOf(i)}
                draggable={false}
                class={`w-full object-cover block ${fill ? "h-full" : "h-auto max-h-96"}`}
              />
            </button>
            {onDescribe && (
              <button
                type="button"
                class={`${describeAt} ${imageButtonClass}`}
                onClick={(e) => {
                  e.stopPropagation();
                  open(i, true);
                }}
                aria-label={t("editor.describeImage")}
              >
                <Captions class="w-4 h-4" />
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                class={`${editAt} ${imageButtonClass}`}
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
                class={`${deleteAt} ${imageButtonClass}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(i);
                }}
                aria-label={t("editor.deleteImage")}
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
          alts={alts}
          onDescribe={onDescribe}
          describing={describing}
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
  alts,
  onDescribe,
  describing,
  index,
  onChangeIndex,
  onClose,
}: {
  images: string[];
  alts: string[] | undefined;
  onDescribe: ((image: string, alt: string) => void) | undefined;
  /** Focus the description field, not the first button. */
  describing: boolean;
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
  // The width over the height of the image that shows, once it is read. Thus,
  // a small image grows to fill the space, as a large one shrinks to it.
  const [shape, setShape] = useState<{ src: string; ratio: number } | null>(
    null,
  );

  // On the dialog, which keeps the focus (`useFocusTrap`), not on the document.
  // The arrows belong to this layer, never to a layer under it.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!hasMultiple || e.defaultPrevented) return;
    // The arrows move the caret in the description, not between images.
    if (e.target instanceof HTMLTextAreaElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const by = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (by === 0) return;
    e.preventDefault();
    step(by);
  };

  const shown = images[index];
  if (shown === undefined) return null;
  const alt = alts?.[index] ?? "";
  const ratio = shape?.src === shown ? shape.ratio : null;

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
        {/* The space for the image, as a container: the image is as large as
            fits in it, in its own shape. */}
        <div
          class={`flex w-full items-center justify-center [container-type:size] ${onDescribe ? "h-[calc(100%-7rem)]" : "h-full"}`}
        >
          <StoredImage
            src={shown}
            alt={alt}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              if (w > 0 && h > 0) setShape({ src: shown, ratio: w / h });
            }}
            style={
              ratio === null
                ? undefined
                : { width: `min(100cqw, ${ratio} * 100cqh)` }
            }
            class="pointer-events-auto max-w-full max-h-full object-contain select-none"
          />
        </div>
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
        {/* After the buttons, though drawn under the image: the focus trap
            starts on the first control, and a field there raised a phone's
            keyboard over the image just opened to look at. "Describe image"
            still comes straight here (`autoFocus`). */}
        {onDescribe && (
          <ImageDescription
            key={shown}
            image={shown}
            alt={alt}
            autoFocus={describing}
            onDescribe={onDescribe}
          />
        )}
      </div>
    </>,
    document.body,
  );
}

/**
 * The description of the shown image, under it in the viewer: what a screen
 * reader reads in its place. The code saves it when the field loses focus, when
 * a different image shows, and when the viewer closes, whichever comes first,
 * and only if it changed.
 */
function ImageDescription({
  image,
  alt,
  autoFocus,
  onDescribe,
}: {
  image: string;
  alt: string;
  autoFocus: boolean;
  onDescribe: (image: string, alt: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(alt);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Read at unmount. Otherwise, it sees only the values of the first render.
  const latest = useRef({ draft, alt, onDescribe });
  latest.current = { draft, alt, onDescribe };

  const save = useCallback(() => {
    const { draft, alt, onDescribe } = latest.current;
    const text = draft.trim();
    if (text !== alt) onDescribe(image, text);
    // Saved one time. A later save compares with the value that was just
    // written.
    latest.current.alt = text;
  }, [image]);

  // Layout. Thus, it runs before the focus trap of the viewer. The trap then
  // finds focus inside, and leaves it here, not on the first button.
  useLayoutEffect(() => {
    if (autoFocus) fieldRef.current?.focus();
  }, [autoFocus]);

  // On the way out, which is when the viewer closed or moved to a different
  // image (the component has its image as the key). A layout effect, whose
  // cleanup runs when the field is removed. The cleanup of an effect ran too
  // late for the close to save before the next frame.
  useLayoutEffect(() => save, [save]);

  return (
    <div class="pointer-events-auto absolute bottom-4 inset-x-4 mx-auto max-w-xl">
      <label for={id} class="block mb-1 text-sm font-medium text-white">
        {t("editor.imageDescription")}
      </label>
      <textarea
        id={id}
        ref={fieldRef}
        rows={2}
        maxLength={MAX_IMAGE_ALT_LENGTH}
        value={draft}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={save}
        placeholder={t("editor.imageDescriptionHint")}
        class="block w-full resize-none rounded-md bg-black/70 text-white placeholder:text-white/60 p-2 text-base sm:text-sm"
      />
    </div>
  );
}
