import { useEffect, useRef, useState } from "preact/hooks";

export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(hover: none)").matches;
  });
  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    const handler = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isTouch;
}

interface TouchGestureOptions {
  enabled: boolean;
  longPressMs?: number;
  dragThresholdPx?: number;
  /**
   * The press was held long enough to be our gesture, not a scroll: the moment
   * when the card lifts. Fires while the finger is still down.
   */
  onHold?: (e: PointerEvent) => void;
  /**
   * A hold ended, however it ended: a release, a drag, or the browser took it.
   * The code removes here all that `onHold` put on the screen. Thus, a gesture
   * that the system cancels cannot leave a card lifted with nothing that holds
   * it.
   */
  onHoldEnd?: () => void;
  /** A hold released without a drag. */
  onLongPress?: (e: PointerEvent) => void;
  onDragStart?: ((e: PointerEvent) => void) | undefined;
  onDragMove?: ((e: PointerEvent) => void) | undefined;
  onDragEnd?: ((e: PointerEvent, didDrag: boolean) => void) | undefined;
}

/**
 * The press-and-hold gesture to which a note card answers on a touch screen:
 * hold to lift it, move to drag it, release without a move to select it.
 *
 * The order keeps the page scrollable. A finger that moves before the hold time
 * is complete scrolls. Thus, the gesture stops, and lets the browser pan. The
 * card is never picked up, dimmed, or selected during the scroll. Only after
 * the hold does a move belong to us.
 *
 * Thus, the card must permit pans (`touch-action: pan-y`, see `.note-draggable`
 * in styles.css). If not, that first swipe would do nothing. The cost is that
 * the browser can also start a scroll on the first move *after* the hold, and
 * after it does, it takes the pointer stream. Thus, a held card cancels the
 * scroll at its source: a non-passive `touchmove` listener calls
 * `preventDefault` from the moment when the hold fires, before the browser
 * commits to a pan. `touch-action` alone cannot say "pannable until held".
 */
export function useTouchGesture(opts: TouchGestureOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const onPointerDown = (e: PointerEvent) => {
    const options = optsRef.current;
    if (!options.enabled) return;
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;

    const el = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const longPressMs = options.longPressMs ?? 450;
    const dragThresholdPx = options.dragThresholdPx ?? 8;

    let held = false;
    let dragging = false;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      el.setPointerCapture(pointerId);
    } catch {}

    function suppressNextClick() {
      const handler = (ev: Event) => {
        ev.stopImmediatePropagation();
        ev.preventDefault();
      };
      el.addEventListener("click", handler, { capture: true, once: true });
      window.setTimeout(() => {
        el.removeEventListener("click", handler, true);
      }, 200);
    }

    function teardown() {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      el.removeEventListener("pointermove", handleMove);
      el.removeEventListener("pointerup", handleUp);
      el.removeEventListener("pointercancel", handleCancel);
      el.removeEventListener("touchmove", handleTouchMove);
    }

    /** Prevents the browser from a pan of the page under a held card. */
    function handleTouchMove(ev: TouchEvent) {
      if (held && ev.cancelable) ev.preventDefault();
    }

    function handleMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const moved = Math.hypot(dx, dy) >= dragThresholdPx;

      if (!held) {
        // A move before the hold is a scroll. Drop the gesture, and leave the
        // page to the browser. Nothing about the card changed yet.
        if (moved) teardown();
        return;
      }

      if (!dragging) {
        if (!moved) return;
        // Held, but this card cannot be reordered here. Stay held, and do not
        // abandon the gesture. The release still selects it.
        if (!optsRef.current.onDragStart) return;
        dragging = true;
        optsRef.current.onDragStart(ev);
      }
      ev.preventDefault();
      optsRef.current.onDragMove?.(ev);
    }

    function handleUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      teardown();
      if (held) optsRef.current.onHoldEnd?.();
      if (dragging) {
        optsRef.current.onDragEnd?.(ev, true);
        suppressNextClick();
      } else if (held) {
        optsRef.current.onLongPress?.(ev);
        suppressNextClick();
      }
    }

    function handleCancel(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      teardown();
      // A cancel is a gesture that the system took away, not a complete
      // gesture: the system claimed the touch. The drag rolls back, and a hold
      // that ended in this way selects nothing, because the reader never
      // released.
      if (held) optsRef.current.onHoldEnd?.();
      if (dragging) optsRef.current.onDragEnd?.(ev, false);
    }

    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      held = true;
      optsRef.current.onHold?.(e);
    }, longPressMs);

    el.addEventListener("pointermove", handleMove);
    el.addEventListener("pointerup", handleUp);
    el.addEventListener("pointercancel", handleCancel);
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
  };

  return { onPointerDown };
}
