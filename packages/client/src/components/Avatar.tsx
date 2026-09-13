/**
 * A user's initial on their avatar colour. Decorative: whatever it sits in
 * carries the name as text or as a label.
 */
export function Avatar({
  name,
  color,
  class: className = "w-9 h-9 text-sm",
}: {
  name: string;
  color: string;
  /** Size and type scale, e.g. `w-7 h-7 text-xs`. */
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
