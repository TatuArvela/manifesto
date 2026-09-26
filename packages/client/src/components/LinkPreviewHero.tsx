import type { LinkPreview } from "@manifesto/shared";
import { Link as LinkIcon } from "lucide-preact";
import { StoredImage } from "./StoredImage.js";

export function LinkPreviewHero({
  preview,
  fill,
}: {
  preview: LinkPreview;
  /**
   * Stretch to the height of a flex column instead of keeping 16:9: a square
   * card is taller than that, and a fixed-shape hero left its bottom third as
   * bare note colour.
   */
  fill?: boolean;
}) {
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      // The card is what a drag picks up. A link, or the picture in it, is
      // draggable by default, and the nearest draggable wins.
      draggable={false}
      class={`block relative ${fill ? "flex-1 min-h-0" : "aspect-video"} w-full bg-black/70 overflow-hidden no-underline text-white`}
      onClick={(e) => e.stopPropagation()}
    >
      {preview.image ? (
        <StoredImage
          src={preview.image}
          alt=""
          draggable={false}
          placeholderClass="block"
          class="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-neutral-600 to-neutral-800">
          <LinkIcon class="w-10 h-10 opacity-70" />
        </div>
      )}
      <div class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
      <div class="absolute bottom-0 left-0 right-0 p-3">
        {/* A bare URL is one long word; let it break anywhere rather than
            run off the card's edge. */}
        <div class="text-base font-medium leading-tight line-clamp-2 [overflow-wrap:anywhere]">
          {preview.title}
        </div>
        {/* The domain alone, with no open-in-a-new-tab glyph beside it. Every
            corner of a card that is all hero has an owner already: the select
            checkbox top left, the pin and its badges top right, the card's
            own buttons along the bottom, and the row of previews below a
            note carries no glyph either. */}
        <div class="text-xs opacity-80 mt-0.5 truncate">{preview.domain}</div>
      </div>
    </a>
  );
}
