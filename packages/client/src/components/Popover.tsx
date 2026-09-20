import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { computePanelPosition, type DropdownPlacement } from "./Dropdown.js";
import { hideAllTooltips } from "./Tooltip.js";

/**
 * Renders children in a fixed-position portal next to the anchor button.
 *
 * Placement goes through the same geometry as `Dropdown`, so the panel flips
 * to the other side of its trigger and stays inside the viewport. It used to
 * be pinned above the anchor with a hardcoded `translateY(-100%)`, which put
 * the menu of any card near the top of the page over the header and off the
 * screen.
 */
export function CardPopover({
  anchorRef,
  onClose,
  children,
  placement = "top-start",
}: {
  anchorRef: preact.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ComponentChildren;
  placement?: DropdownPlacement;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const updatePos = () => {
      const anchor = anchorRef.current;
      const panel = popoverRef.current;
      if (!anchor || !panel) return;
      setPos(
        computePanelPosition(
          anchor.getBoundingClientRect(),
          panel.getBoundingClientRect(),
          {
            width: document.documentElement.clientWidth,
            height: document.documentElement.clientHeight,
          },
          placement,
        ),
      );
    };
    updatePos();
    // Panels here change size while open (the kebab menu grows when the tag
    // picker expands inside it), so re-place on their own resize too.
    const panel = popoverRef.current;
    const ro = panel ? new ResizeObserver(updatePos) : null;
    if (panel && ro) ro.observe(panel);
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      ro?.disconnect();
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [anchorRef, placement]);

  // The trigger's tooltip would otherwise stay up underneath this panel:
  // the pointer never leaves the trigger, so no `pointerleave` arrives.
  useEffect(hideAllTooltips, []);

  // Mounted only while open, so it is always the top of the stack when it is
  // on screen.
  useEscapeStack(true, onClose);

  return createPortal(
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
      <div class="fixed inset-0 z-40" onClick={onClose} />
      {/* Always rendered so it can be measured, but kept invisible until it
          has been placed; otherwise it would flash at the top-left corner. */}
      <div
        ref={popoverRef}
        class="card-popover fixed z-50"
        data-placed={pos ? "true" : undefined}
        style={{
          top: `${pos?.top ?? 0}px`,
          left: `${pos?.left ?? 0}px`,
          visibility: pos ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
