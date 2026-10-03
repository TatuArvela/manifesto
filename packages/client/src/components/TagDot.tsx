import { swatchClass } from "../colors.js";
import { tagColors } from "../state/index.js";

/**
 * The dot of a tag's colour, drawn before its name wherever the user's own
 * tags are shown; nothing for a tag with no colour. A dot rather than a tinted
 * chip, since a chip sits on a note of any colour, the tag's own included.
 */
export function TagDot({ tag }: { tag: string }) {
  const color = tagColors.value[tag];
  if (color === undefined) return null;
  return (
    <span
      aria-hidden="true"
      data-tag-color={color}
      class={`inline-block w-2 h-2 rounded-full shrink-0 ring-1 ring-black/10 dark:ring-white/20 ${swatchClass[color]}`}
    />
  );
}
