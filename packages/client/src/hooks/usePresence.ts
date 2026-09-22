import { useEffect, useState } from "preact/hooks";

/**
 * Keeps the last non-null `value` on screen for `exitMs` after it goes null,
 * so what it renders can play an exit instead of vanishing in the frame it is
 * closed. Returns what to render and whether that is on its way out.
 *
 * A new value replaces the old one at once, with no exit: one panel handing
 * over to another (a menu opening the reminder picker) should not wait on the
 * first one's fade.
 */
export function usePresence<T>(
  value: T | null,
  exitMs: number,
): { shown: T | null; leaving: boolean } {
  // What was last open, which is what a closing value goes on rendering.
  const [shown, setShown] = useState<T | null>(value);

  useEffect(() => {
    if (value !== null) {
      setShown(value);
      return;
    }
    const timer = setTimeout(() => setShown(null), exitMs);
    return () => clearTimeout(timer);
  }, [value, exitMs]);

  return {
    shown: value ?? shown,
    leaving: value === null && shown !== null,
  };
}
