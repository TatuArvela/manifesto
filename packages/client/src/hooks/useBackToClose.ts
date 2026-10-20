import { useLayoutEffect, useRef } from "preact/hooks";
import { openHistoryLayer } from "#/state/sheetHistory.ts";

/**
 * Makes the back of the browser call `onBack` while `active`. A sheet gives its
 * open state. Thus, its entry goes when it starts to close. An `onBack` that
 * returns `false` kept the sheet open (it asks first), and back stays with it.
 * `state/sheetHistory.ts` tells how the entries are kept.
 */
export function useBackToClose(active: boolean, onBack: () => unknown): void {
  const handler = useRef(onBack);
  handler.current = onBack;

  useLayoutEffect(() => {
    if (!active) return;
    return openHistoryLayer(() => handler.current());
  }, [active]);
}
