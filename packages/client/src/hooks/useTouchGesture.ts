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
  onLongPress?: (e: PointerEvent) => void;
  onDragStart?: (e: PointerEvent) => void;
  onDragMove?: (e: PointerEvent) => void;
  onDragEnd?: (e: PointerEvent, didDrag: boolean) => void;
}

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

    let dragging = false;
    let longPressFired = false;
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
    }

    function handleMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      if (longPressFired) return;
      if (!dragging) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.hypot(dx, dy) < dragThresholdPx) return;
        if (longPressTimer !== null) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        if (!optsRef.current.onDragStart) {
          // Movement past threshold but card isn't draggable — abandon gesture.
          teardown();
          return;
        }
        dragging = true;
        optsRef.current.onDragStart(ev);
      }
      ev.preventDefault();
      optsRef.current.onDragMove?.(ev);
    }

    function handleUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      teardown();
      if (dragging) {
        optsRef.current.onDragEnd?.(ev, true);
        suppressNextClick();
      } else if (longPressFired) {
        suppressNextClick();
      }
    }

    function handleCancel(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      teardown();
      if (dragging) {
        optsRef.current.onDragEnd?.(ev, false);
      }
    }

    longPressTimer = setTimeout(() => {
      if (dragging) return;
      longPressFired = true;
      longPressTimer = null;
      optsRef.current.onLongPress?.(e);
    }, longPressMs);

    el.addEventListener("pointermove", handleMove);
    el.addEventListener("pointerup", handleUp);
    el.addEventListener("pointercancel", handleCancel);
  };

  return { onPointerDown };
}
