/**
 * Runs `fn` after the next paint: in a task that the callback of the next
 * animation frame queues, after the browser drew that frame. Returns the call
 * that cancels it.
 *
 * Not `useEffect`. Preact runs effects after the next frame or after 35 ms,
 * whichever comes first. Thus, after a task longer than that (the open of a
 * note), its effects ran before the first paint, and their work came before
 * the first frame.
 */
export function afterNextPaint(fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (typeof requestAnimationFrame !== "function") {
    timer = setTimeout(fn, 0);
    return () => clearTimeout(timer);
  }
  const raf = requestAnimationFrame(() => {
    timer = setTimeout(fn, 0);
  });
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
  };
}
