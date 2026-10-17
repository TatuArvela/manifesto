import { useEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "./useEscapeStack.ts";
import { useFocusTrap } from "./useFocusTrap.ts";

/** How long the panel takes to fade out. */
const CLOSE_MS = 150;

/**
 * The version history panel over an open note: whether it is shown, whether
 * it is fading out, and the Escape and focus trap it holds while it is up.
 *
 * Call it after the editor's own `useEscapeStack`, so that a press over the
 * panel closes the panel and not the editor under it.
 */
export function useVersionsPanel(openAtStart: boolean): {
  shown: boolean;
  closing: boolean;
  open: () => void;
  close: () => void;
  dialogRef: ReturnType<typeof useFocusTrap<HTMLDivElement>>;
} {
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Opened a render after the editor, not with it: the history's Escape has
  // to register after the editor's, or one press would close the editor
  // under it (see `useEscapeStack`).
  useEffect(() => {
    if (openAtStart) setShown(true);
  }, [openAtStart]);

  const close = () => {
    setClosing(true);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setShown(false);
      setClosing(false);
    }, CLOSE_MS);
  };

  useEscapeStack(shown && !closing, close);
  const dialogRef = useFocusTrap<HTMLDivElement>(shown && !closing);

  return { shown, closing, open: () => setShown(true), close, dialogRef };
}
