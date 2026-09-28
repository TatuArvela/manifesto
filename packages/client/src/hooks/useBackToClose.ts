import { useLayoutEffect, useRef } from "preact/hooks";
import { openHistoryLayer } from "../state/sheetHistory.js";

/**
 * Makes the browser's back call `onBack` while `active`. A sheet passes its
 * open state, so its entry goes as soon as it starts to close. How the entries
 * are kept is in `state/sheetHistory.ts`.
 */
export function useBackToClose(active: boolean, onBack: () => void): void {
  const handler = useRef(onBack);
  handler.current = onBack;

  useLayoutEffect(() => {
    if (!active) return;
    return openHistoryLayer(() => handler.current());
  }, [active]);
}
