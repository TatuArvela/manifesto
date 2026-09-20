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
   * The press has been held long enough to be a gesture of ours rather than a
   * scroll: the moment the card lifts. Fires while the finger is still down.
   */
  onHold?: (e: PointerEvent) => void;
  /**
   * A hold has ended, however it ended: released, dragged, or taken away by
   * the browser. Whatever `onHold` put on screen comes off here, so a gesture
   * the system cancels cannot leave a card lifted with nothing holding it.
   */
  onHoldEnd?: () => void;
  /** A hold released without ever becoming a drag. */
  onLongPress?: (e: PointerEvent) => void;
  onDragStart?: (e: PointerEvent) => void;
  onDragMove?: (e: PointerEvent) => void;
  onDragEnd?: (e: PointerEvent, didDrag: boolean) => void;
}

/**
 * The press-and-hold gesture a note card answers to on a touch screen: hold to
 * lift it, move to drag it, release without moving to select it.
 *
 * The ordering is what makes the page scrollable. A finger that moves before
 * the hold has elapsed is scrolling, so the gesture stands aside and lets the
 * browser pan; the card is never picked up, dimmed, or selected on the way
 * past. Only after the hold does movement belong to us.
 *
 * Which means the card must allow panning (`touch-action: pan-y`, see
 * `.note-draggable` in styles.css) or that first swipe would do nothing at all.
 * The cost is that the browser is also free to start a scroll on the first move
 * *after* the hold, and once it has, it takes the pointer stream with it. So a
 * held card cancels the scroll at its source: a non-passive `touchmove`
 * listener that calls `preventDefault` from the moment the hold fires, before
 * the browser has committed to a pan. `touch-action` alone cannot express
 * "pannable until held".
 */
export function useTouchGesture(opts: TouchGestureOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const onPointerDown = (e: PointerEvent) => {
    const o = optsRef.current;
    if (!o.enabled) return;
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;

    const el = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const longPressMs = o.longPressMs ?? 450;
    const dragThresholdPx = o.dragThresholdPx ?? 8;

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

    /** Keeps the browser from panning the page out from under a held card. */
    function handleTouchMove(ev: TouchEvent) {
      if (held && ev.cancelable) ev.preventDefault();
    }

    function handleMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const moved = Math.hypot(dx, dy) >= dragThresholdPx;

      if (!held) {
        // Moving before the hold is a scroll. Drop the gesture and leave the
        // page to the browser; nothing about the card has changed yet.
        if (moved) teardown();
        return;
      }

      if (!dragging) {
        if (!moved) return;
        // Held, but this card cannot be reordered here. Stay held rather than
        // abandoning: releasing still selects it.
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
      // A cancel is the gesture being taken away rather than completed: the
      // system claimed the touch. The drag rolls back and a hold that ended
      // this way selects nothing, because the reader never let go.
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
