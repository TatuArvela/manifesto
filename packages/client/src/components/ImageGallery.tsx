import { X } from "lucide-preact";
import { t } from "../i18n/index.js";

interface ImageGalleryProps {
  images: string[];
  onDelete?: (index: number) => void;
}

export function ImageGallery({ images, onDelete }: ImageGalleryProps) {
  if (images.length === 0) return null;

  return (
    <div class="flex flex-col">
      {images.map((src, i) => (
        <div
          key={`${i}-${src.slice(0, 32)}`}
          class="relative group/img bg-black/5 dark:bg-white/5"
        >
          <img
            src={src}
            alt=""
            class="w-full h-auto object-cover max-h-96 block"
          />
          {onDelete && (
            <button
              type="button"
              class="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover/img:opacity-100 hover:bg-black/80 transition-opacity cursor-pointer"
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
  );
}
