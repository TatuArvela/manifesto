import type { ComponentChildren } from "preact";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";

let nextId = 0;

// Show tooltips on focus only when the user really navigates with a keyboard.
// If not, a tap on a button would focus it, and the tooltip would stay open (no
// mouseleave follows a tap on iOS).
let lastInputKeyboard = false;

/**
 * Show timers that still count down. Thus, `hideAllTooltips` can cancel them.
 */
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
 * Tooltips show after a delay. Thus, a click that opens a panel under the
 * cursor can leave one on top of that panel. The pointer never leaves the
 * trigger. Thus, no `pointerleave` arrives to hide it. Each element that opens
 * over its own trigger calls this first.
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The popover and its anchor are in the page from the first show, and stay.
  // Each tooltip kept a closed popover before: 26 of them in an open note,
  // about a sixth of its elements, all made in the task of the click.
  const [mounted, setMounted] = useState(false);
  // A show that waits for the popover to mount.
  const showOnMountRef = useRef(false);

  const cancelPending = useCallback(() => {
    showOnMountRef.current = false;
    if (timeoutRef.current === undefined) return;
    clearTimeout(timeoutRef.current);
    pendingTimers.delete(timeoutRef.current);
    timeoutRef.current = undefined;
  }, []);

  const show = () => {
    cancelPending();
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      timeoutRef.current = undefined;
      if (popoverRef.current) {
        popoverRef.current.showPopover();
        return;
      }
      showOnMountRef.current = true;
      setMounted(true);
    }, 200);
    timeoutRef.current = timer;
    pendingTimers.add(timer);
  };

  // The first show, in the commit that mounts the popover. Thus, it is in the
  // top layer before the browser paints it.
  useLayoutEffect(() => {
    if (!mounted || !showOnMountRef.current) return;
    showOnMountRef.current = false;
    popoverRef.current?.showPopover();
  }, [mounted]);

  const hide = () => {
    cancelPending();
    popoverRef.current?.hidePopover();
  };

  useEffect(() => cancelPending, [cancelPending]);

  // Escape hides a tooltip, and does not move the pointer or the focus off its
  // trigger. Thus, you can put away a tooltip that covers what you read. It
  // sends the press on, because Escape is never only for a tooltip. The code
  // follows the own `toggle` event of the popover, because `hideAllTooltips`
  // hides it from outside this component.
  const [shown, setShown] = useState(false);
  useEscapeStack(shown, hide, { passThrough: true });

  return (
    // biome-ignore lint/a11y/useSemanticElements: tooltip wrapper needs span
    <span
      class="inline-flex items-center"
      role="group"
      style={mounted ? { anchorName: idRef.current } : undefined}
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
      {mounted && (
        <div
          ref={popoverRef}
          popover="manual"
          onToggle={(e) => setShown(e.newState === "open")}
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
      )}
    </span>
  );
}
