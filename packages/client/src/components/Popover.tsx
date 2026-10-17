import type { ComponentChildren } from "preact";
import { createPortal } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "#/hooks/useEscapeStack.js";
import { tabbableIn } from "#/hooks/useFocusTrap.js";
import { computePanelPosition, type DropdownPlacement } from "./Dropdown.js";
import { hideAllTooltips } from "./Tooltip.js";

/**
 * Renders children in a fixed-position portal next to the anchor button.
 *
 * Placement goes through the same geometry as `Dropdown`, so the panel flips
 * to the other side of its trigger and stays inside the viewport, even for a
 * card at the top of the page.
 */
/** How long a card popover takes to leave; `card-popover-out` in styles.css. */
export const CARD_POPOVER_EXIT_MS = 140;

export function CardPopover({
  anchorRef,
  onClose,
  children,
  placement = "bottom-start",
  leaving = false,
}: {
  anchorRef: preact.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ComponentChildren;
  placement?: DropdownPlacement;
  /**
   * Closed, and playing its exit (see `usePresence`): it no longer takes
   * clicks, keys or the Escape key, so the page under it is live at once.
   */
  leaving?: boolean;
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

  // Mounted only while open or leaving, so it is always the top of the stack
  // while it is open.
  useEscapeStack(!leaving, onClose);

  // Focus goes in once the panel is placed (a hidden panel takes no focus),
  // to the current choice where there is one marked, unless something in it
  // has taken focus itself (the tag picker's field). The panel is portalled
  // to the end of the page, so without this the keyboard never reached it:
  // Tab from its trigger went on to the next card.
  const placed = pos !== null;
  useEffect(() => {
    const panel = popoverRef.current;
    if (!placed || !panel || panel.contains(document.activeElement)) return;
    const current = panel.querySelector<HTMLElement>(
      '[aria-pressed="true"], [aria-checked="true"]',
    );
    (current ?? tabbableIn(panel)[0])?.focus();
  }, [placed]);

  // And back to the trigger once it closes, if focus was in the panel and
  // nothing else has taken it: a choice that opens a dialog keeps the
  // dialog's focus, which its own trap has moved by the time this runs.
  useEffect(() => {
    const panel = popoverRef.current;
    if (!leaving || !panel) return;
    const active = document.activeElement;
    if (active && active !== document.body && !panel.contains(active)) return;
    const anchor = anchorRef.current;
    if (anchor?.isConnected && !anchor.closest('[data-leaving="true"]')) {
      anchor.focus();
    }
  }, [leaving, anchorRef]);

  return createPortal(
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
      {!leaving && <div class="fixed inset-0 z-40" onClick={onClose} />}
      {/* Always rendered so it can be measured, but kept invisible until it
          has been placed; otherwise it would flash at the top-left corner. */}
      <div
        ref={popoverRef}
        class={`card-popover fixed z-50${leaving ? " pointer-events-none" : ""}`}
        data-placed={pos ? "true" : undefined}
        data-leaving={leaving ? "true" : undefined}
        inert={leaving}
        // Tabbing out of the panel closes it, as a menu does, rather than
        // leaving it open over a page the keyboard has moved on through.
        onFocusOut={(e) => {
          const to = e.relatedTarget;
          if (to instanceof Node && !e.currentTarget.contains(to)) onClose();
        }}
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
