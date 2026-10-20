import { useEffect, useState } from "preact/hooks";

/**
 * Keeps the last value that is not null on the screen for `exitMs` after it
 * becomes null. Thus, what it renders can play an exit, and does not disappear
 * in the frame where it closes. Returns what to render, and if it is on its way
 * out.
 *
 * A new value replaces the old value immediately, with no exit. When one panel
 * changes to a different panel (a menu that opens the reminder picker), the
 * change must not wait for the fade of the first panel.
 */
export function usePresence<T>(
  value: T | null,
  exitMs: number,
): { shown: T | null; leaving: boolean } {
  // The last open value, which a closing value continues to render.
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
