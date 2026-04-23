import type { LinkPreview } from "@manifesto/shared";
import { Link as LinkIcon, X } from "lucide-preact";
import { t } from "../i18n/index.js";

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
  onRemove?: () => void;
}) {
  const clickable = variant === "card";
  const content = (
    <div
      class={`group/lp relative flex items-stretch rounded-lg overflow-hidden bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 ${clickable ? "hover:bg-black/10 dark:hover:bg-white/10 transition-colors" : ""}`}
    >
      <div class="w-20 shrink-0 bg-black/10 dark:bg-white/10 flex items-center justify-center">
        {preview.image ? (
          <img src={preview.image} alt="" class="w-full h-full object-cover" />
        ) : preview.favicon ? (
          <img src={preview.favicon} alt="" class="w-6 h-6 object-contain" />
        ) : (
          <LinkIcon class="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
        )}
      </div>
      <div class="flex-1 min-w-0 px-3 py-2 pr-8">
        <div class="text-sm font-medium truncate">{preview.title}</div>
        <div class="text-xs text-neutral-500 dark:text-neutral-400 truncate">
          {preview.domain}
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          class="absolute top-1 right-1 p-1 rounded-full bg-black/40 text-white opacity-0 group-hover/lp:opacity-100 hover:bg-black/60 transition-opacity cursor-pointer"
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
        class="block no-underline"
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </a>
    );
  }
  return content;
}
