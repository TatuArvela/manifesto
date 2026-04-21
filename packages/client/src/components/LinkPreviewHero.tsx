import type { LinkPreview } from "@manifesto/shared";
import { ExternalLink, Link as LinkIcon } from "lucide-preact";

export function LinkPreviewHero({ preview }: { preview: LinkPreview }) {
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      class="block relative aspect-video w-full bg-black/70 overflow-hidden no-underline text-white"
      onClick={(e) => e.stopPropagation()}
    >
      {preview.image ? (
        <img
          src={preview.image}
          alt=""
          class="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-600 to-gray-800">
          <LinkIcon class="w-10 h-10 opacity-70" />
        </div>
      )}
      <div class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
      <div class="absolute top-2 right-2 opacity-80">
        <ExternalLink class="w-4 h-4" />
      </div>
      <div class="absolute bottom-0 left-0 right-0 p-3">
        <div class="text-base font-medium leading-tight line-clamp-2">
          {preview.title}
        </div>
        <div class="text-xs opacity-80 mt-0.5 truncate">{preview.domain}</div>
      </div>
    </a>
  );
}
