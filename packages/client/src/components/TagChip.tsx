import type { ComponentChildren } from "preact";
import { tagChipColors } from "#/colors.ts";
import { tagColorOf } from "#/state/views.ts";

const PLAIN = "bg-neutral-200/60 dark:bg-neutral-700/60";

/**
 * The background of the chip of a tag: its color, its own or from a tag above
 * it, with an outline of the same hue, or `plain` for a tag with no color. The
 * outline keeps the chip separate from a note of the own color of the tag.
 */
export function tagTint(tag: string, plain = PLAIN): string {
  const color = tagColorOf(tag);
  if (color === undefined) return plain;
  const { bg, ring } = tagChipColors[color];
  return `${bg} ring-1 ring-inset ${ring}`;
}

/**
 * A tag on a note, in the own color of the user for it. `children` come after
 * the name. The editor puts its remove button there.
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
