import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

/**
 * One choice of the board's composer, as a card: the colours side by side,
 * and the pattern beside its colour and opacity. `detail` names what is
 * chosen, for a card whose choices carry no names of their own.
 */
export function BoardCard({
  legend,
  detail,
  disabled,
  children,
}: {
  legend: string;
  detail?: string | undefined;
  disabled?: boolean | undefined;
  children: ComponentChildren;
}) {
  const legendId = useId();
  return (
    <fieldset
      aria-labelledby={legendId}
      disabled={disabled}
      class="min-w-0 rounded-xl p-2.5 sm:p-3 bg-neutral-100 dark:bg-white/[0.04]"
    >
      <p class="flex justify-between gap-2 mb-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span id={legendId} class="font-medium truncate">
          {legend}
        </span>
        {detail && <span class="truncate">{detail}</span>}
      </p>
      {children}
    </fieldset>
  );
}
