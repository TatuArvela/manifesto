import type { ComponentChildren } from "preact";
import { tagChipColors } from "../colors.js";
import { tagColorOf } from "../state/index.js";

const PLAIN = "bg-neutral-200/60 dark:bg-neutral-700/60";

/**
 * The background of a tag's chip: its colour, its own or from a tag above it,
 * with an outline of the same hue, or `plain` for a tag with none. The outline
 * is what keeps the chip apart from a note of the tag's own colour.
 */
export function tagTint(tag: string, plain = PLAIN): string {
  const color = tagColorOf(tag);
  if (color === undefined) return plain;
  const { bg, ring } = tagChipColors[color];
  return `${bg} ring-1 ring-inset ${ring}`;
}

/**
 * A tag on a note, in the user's own colour for it. `children` follow the
 * name, which is where the editor puts its remove button.
 */
export function TagChip({
  tag,
  children,
}: {
  tag: string;
  children?: ComponentChildren;
}) {
  return (
    <span
      data-tag-color={tagColorOf(tag)}
      class={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${tagTint(tag)}`}
    >
      #{tag}
      {children}
    </span>
  );
}
