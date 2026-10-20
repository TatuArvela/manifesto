/**
 * The initial of a user on their avatar color. Decorative: the element that
 * contains it gives the name as text or as a label.
 */
export function Avatar({
  name,
  color,
  class: className = "w-9 h-9 text-sm",
}: {
  name: string;
  color: string;
  /** The size and the type scale, for example `w-7 h-7 text-xs`. */
  class?: string;
}) {
  return (
    <span
      aria-hidden="true"
      class={`${className} shrink-0 rounded-full flex items-center justify-center font-semibold text-white bg-neutral-400`}
      style={color ? { backgroundColor: color } : undefined}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
