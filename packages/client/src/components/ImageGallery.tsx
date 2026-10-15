import { MAX_IMAGE_ALT_LENGTH } from "@manifesto/shared";
import { Captions, ChevronLeft, ChevronRight, PenLine, X } from "lucide-preact";
import { createPortal } from "preact";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { t } from "../i18n/index.js";
import { Backdrop } from "./Backdrop.js";
import { StoredImage } from "./StoredImage.js";

interface ImageGalleryProps {
  images: string[];
  /** What each image shows, in words, in step with `images`: its `alt`. */
  alts?: string[] | undefined;
  /**
   * Gives an image its description; left out where it cannot change. The
   * image is named by its reference rather than its place, which another
   * writer may have moved by the time this lands.
   */
  onDescribe?: ((image: string, alt: string) => void) | undefined;
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
  alts,
  onDescribe,
  onDelete,
  onEdit,
  fill,
}: ImageGalleryProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Opened from "Describe image", which goes straight to the field.
  const [describing, setDescribing] = useState(false);
  const open = (index: number, describe: boolean) => {
    setDescribing(describe);
    setOpenIndex(index);
  };

  if (images.length === 0) return null;
  const altOf = (i: number) => alts?.[i] ?? "";
  // The buttons over an image sit right to left: delete, draw, describe.
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
  /** Focus the description field rather than the first button. */
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

  // On the dialog, which holds the focus (`useFocusTrap`), rather than on the
  // document: the arrows are this layer's, and never anything under it.
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
          alt={alt}
          class={`pointer-events-auto max-w-full object-contain select-none ${onDescribe ? "max-h-[calc(100%-7rem)]" : "max-h-full"}`}
        />
        {onDescribe && (
          <ImageDescription
            key={shown}
            image={shown}
            alt={alt}
            autoFocus={describing}
            onDescribe={onDescribe}
          />
        )}
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

/**
 * The description of the image shown, under it in the viewer: what a screen
 * reader reads in its place. Saved when the field is left, when another image
 * is shown and when the viewer closes, whichever comes first, and only if it
 * changed.
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
  // Read at unmount, which sees only the first render's values otherwise.
  const latest = useRef({ draft, alt, onDescribe });
  latest.current = { draft, alt, onDescribe };

  const save = useCallback(() => {
    const { draft, alt, onDescribe } = latest.current;
    const text = draft.trim();
    if (text !== alt) onDescribe(image, text);
    // Saved once: a later save compares with what was just written.
    latest.current.alt = text;
  }, [image]);

  useEffect(() => {
    if (autoFocus) fieldRef.current?.focus();
  }, [autoFocus]);

  // On the way out, which is when the viewer closed or moved to another
  // image (the component is keyed by its image). A layout effect, whose
  // cleanup runs as the field is removed: an effect's cleanup ran too late
  // for the close to have saved by the next frame.
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
