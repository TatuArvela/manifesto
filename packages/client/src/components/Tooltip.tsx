import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

let nextId = 0;

// Only show focus-triggered tooltips when the user is actually navigating
// with a keyboard. Otherwise a tap on a button would focus it and leave the
// tooltip stuck open (no mouseleave follows a tap on iOS).
let lastInputKeyboard = false;

/** Show-timers still counting down, so `hideAllTooltips` can cancel them. */
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    () => {
      lastInputKeyboard = true;
    },
    true,
  );
  window.addEventListener(
    "pointerdown",
    () => {
      lastInputKeyboard = false;
    },
    true,
  );
}

/**
 * Tooltips are shown on a delay, so a click that opens a panel under the
 * cursor can leave one stranded on top of that panel — the pointer never
 * leaves the trigger, so no `pointerleave` arrives to hide it. Anything that
 * opens over its own trigger calls this first.
 */
export function hideAllTooltips() {
  for (const timer of pendingTimers) clearTimeout(timer);
  pendingTimers.clear();
  for (const el of document.querySelectorAll<HTMLElement>(
    ".tooltip:popover-open",
  )) {
    el.hidePopover();
  }
}

export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  const idRef = useRef("");
  if (!idRef.current) idRef.current = `--tt-${++nextId}`;
  const popoverRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const cancelPending = () => {
    if (timeoutRef.current === undefined) return;
    clearTimeout(timeoutRef.current);
    pendingTimers.delete(timeoutRef.current);
    timeoutRef.current = undefined;
  };

  const show = () => {
    cancelPending();
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      timeoutRef.current = undefined;
      popoverRef.current?.showPopover();
    }, 200);
    timeoutRef.current = timer;
    pendingTimers.add(timer);
  };

  const hide = () => {
    cancelPending();
    popoverRef.current?.hidePopover();
  };

  useEffect(() => cancelPending, []);

  return (
    // biome-ignore lint/a11y/useSemanticElements: tooltip wrapper needs span
    <span
      class="inline-flex items-center"
      role="group"
      style={{ anchorName: idRef.current }}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") show();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") hide();
      }}
      onFocusCapture={() => {
        if (lastInputKeyboard) show();
      }}
      onBlurCapture={hide}
    >
      {children}
      <div
        ref={popoverRef}
        popover="manual"
        class="tooltip"
        style={{ positionAnchor: idRef.current }}
      >
        {label.split("\n").map((line, i, arr) => (
          <span key={`${i}:${line}`}>
            {line}
            {i < arr.length - 1 && <br />}
          </span>
        ))}
      </div>
    </span>
  );
}
