import { useEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "./useEscapeStack.ts";
import { useFocusTrap } from "./useFocusTrap.ts";

/** How long the panel takes to fade out. */
const CLOSE_MS = 150;

/**
 * The version history panel over an open note: if it shows, if it fades out,
 * and the Escape and focus trap that it has while it is open.
 *
 * Call it after the own `useEscapeStack` of the editor. Thus, a press over the
 * panel closes the panel, not the editor under it.
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

  // Opened one render after the editor, not with it. The Escape of the history
  // must register after that of the editor. If not, one press would close the
  // editor under it (see `useEscapeStack`).
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
