import type { LinkPreview } from "@manifesto/shared";
import { Link as LinkIcon, X } from "lucide-preact";
import { noteText } from "#/colors.ts";
import { t } from "#/i18n/index.ts";
import { StoredImage } from "./StoredImage.tsx";

interface LinkPreviewListProps {
  previews: LinkPreview[];
  variant: "editor" | "card";
  onRemove?: (index: number) => void;
}

export function LinkPreviewList({
  previews,
  variant,
  onRemove,
}: LinkPreviewListProps) {
  if (previews.length === 0) return null;

  return (
    <div class="flex flex-col gap-2">
      {previews.map((p, i) => (
        <LinkPreviewRow
          key={`${i}-${p.url}`}
          preview={p}
          variant={variant}
          onRemove={onRemove ? () => onRemove(i) : undefined}
        />
      ))}
    </div>
  );
}

function LinkPreviewRow({
  preview,
  variant,
  onRemove,
}: {
  preview: LinkPreview;
  variant: "editor" | "card";
  onRemove?: (() => void) | undefined;
}) {
  const clickable = variant === "card";
  const content = (
    <div
      class={`relative flex items-stretch rounded-lg overflow-hidden bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 ${clickable ? "hover:bg-black/10 dark:hover:bg-white/10 transition-colors" : ""}`}
    >
      <div class="w-20 shrink-0 bg-black/10 dark:bg-white/10 flex items-center justify-center">
        {preview.image ? (
          <StoredImage
            src={preview.image}
            alt=""
            draggable={false}
            placeholderClass="block"
            class="w-full h-full object-cover"
          />
        ) : preview.favicon ? (
          <StoredImage
            src={preview.favicon}
            alt=""
            draggable={false}
            placeholderClass="block"
            class="w-6 h-6 object-contain"
          />
        ) : (
          <LinkIcon class={`w-5 h-5 ${noteText.icon}`} />
        )}
      </div>
      <div class="flex-1 min-w-0 px-3 py-2 pr-8">
        <div class="text-sm font-medium truncate">{preview.title}</div>
        <div class={`text-xs truncate ${noteText.quiet}`}>{preview.domain}</div>
      </div>
      {onRemove && (
        <button
          type="button"
          class="absolute top-1 right-1 p-1 rounded-full text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-100 hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onRemove();
          }}
          aria-label={t("linkPreview.remove")}
        >
          <X class="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );

  if (clickable) {
    return (
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        // As on the hero: the card is what a drag picks up.
        draggable={false}
        class="block no-underline"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </a>
    );
  }
  return content;
}
