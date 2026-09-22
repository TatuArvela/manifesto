import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { hideAllTooltips } from "./Tooltip.js";

let nextId = 0;

export type DropdownPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end";

/**
 * Whether the browser can position the panel against its trigger in CSS.
 * Where it can, placement (including flipping at the viewport edge) is handled
 * entirely by the stylesheet; where it can't, `placePanel` below does the same
 * job in script.
 */
const supportsAnchorPositioning =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("position-area", "block-end");

const EDGE_GAP = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Where the panel should sit relative to its trigger, for browsers without CSS
 * anchor positioning. Mirrors what the `position-area` rules do: sit on the
 * requested side of the trigger, flip to the opposite side when there isn't
 * room, and stay clear of the viewport edges either way.
 *
 * Pure so the geometry can be tested without a layout.
 */
export function computePanelPosition(
  anchor: { top: number; bottom: number; left: number; right: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: DropdownPlacement,
): { left: number; top: number } {
  const [block, inline] = placement.split("-");

  const below = anchor.bottom + EDGE_GAP;
  const above = anchor.top - panel.height - EDGE_GAP;
  let top = block === "bottom" ? below : above;
  // Flip only when the opposite side actually has room, so a panel taller than
  // the viewport doesn't swap to an equally bad position.
  if (
    block === "bottom" &&
    below + panel.height > viewport.height &&
    above >= 0
  ) {
    top = above;
  }
  if (block === "top" && above < 0 && below + panel.height <= viewport.height) {
    top = below;
  }

  // "start" aligns the panel's leading edge with the trigger's, "end" its
  // trailing edge, matching `span-inline-end` / `span-inline-start` in CSS.
  const left = inline === "start" ? anchor.left : anchor.right - panel.width;

  return {
    left: clamp(left, EDGE_GAP, viewport.width - panel.width - EDGE_GAP),
    top: clamp(top, EDGE_GAP, viewport.height - panel.height - EDGE_GAP),
  };
}

function placePanel(
  panel: HTMLElement,
  anchor: HTMLElement,
  placement: DropdownPlacement,
) {
  const { left, top } = computePanelPosition(
    anchor.getBoundingClientRect(),
    panel.getBoundingClientRect(),
    {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
    placement,
  );
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

/** How long a panel takes to leave; the `.dropdown-panel` transition's. */
export const DROPDOWN_EXIT_MS = 140;

/**
 * Generic dropdown built on the Popover API + CSS anchor positioning, so the
 * panel renders in the top layer and is not clipped by ancestor
 * `overflow: hidden`.
 *
 * The popover is `manual`, and this component dismisses it (outside presses,
 * Escape) and decides when it leaves the top layer: only once its exit has
 * played. With `popover="auto"` the browser hid the panel the moment it was
 * dismissed, and the exit could only be seen where the top layer itself can be
 * transitioned (`overlay`, Chromium only). Elsewhere the panel dropped out
 * from over the page and was cut off or drawn under the header as it faded.
 *
 * Before opening, any other open dropdown panel is asked to close through its
 * `toggle` event: neither the browser's auto-popover stack nor a module-level
 * tracker proved reliable across the modal portal, so the DOM is queried.
 */
export function Dropdown({
  open,
  onClose,
  trigger,
  children,
  panelClass,
  placement = "bottom-start",
}: {
  open: boolean;
  onClose: () => void;
  trigger: ComponentChildren;
  children: ComponentChildren;
  panelClass?: string;
  placement?: DropdownPlacement;
}) {
  const idRef = useRef("");
  if (!idRef.current) idRef.current = `--dd-${++nextId}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openRef = useRef(open);
  openRef.current = open;
  // Whether the panel is in the top layer, which outlasts `open` by the exit.
  // `leaving` is derived in render rather than set by an effect: an effect
  // runs after a frame in which the panel is neither open nor leaving, and
  // that frame's `display: none` cancelled the exit before it started.
  const [shown, setShown] = useState(false);
  const leaving = !open && shown;
  // Whether the panel was open when the pointer last went down on the
  // trigger. A tap delivers its click as a separate gesture, after an outside
  // press has already closed the panel, so the trigger would see it closed and
  // open it again: the menu could not be shut from its own button.
  const openAtPointerDownRef = useRef(false);

  useEscapeStack(open, () => onCloseRef.current());

  // Another dropdown opening closes this one by hiding its popover, which
  // arrives here as `toggle`. Only reported while this panel is meant to be
  // open, since its own exit ends with a hide too.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const handleToggle = (e: Event) => {
      const newState = (e as unknown as { newState: string }).newState;
      if (newState === "closed" && openRef.current) onCloseRef.current();
    };
    el.addEventListener("toggle", handleToggle);
    return () => el.removeEventListener("toggle", handleToggle);
  }, []);

  // A press anywhere but the panel and its trigger dismisses it, as the
  // browser's light-dismiss did. The trigger's own press is left to the
  // trigger, which toggles.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const isOpen = el.matches(":popover-open");
    if (open) {
      if (isOpen) return; // Reopened mid-exit: it transitions back.
      // The trigger's own tooltip would otherwise sit on top of the panel we
      // are about to open, because the pointer never leaves the trigger, so
      // nothing hides it.
      hideAllTooltips();
      document
        .querySelectorAll<HTMLElement>(".dropdown-panel:popover-open")
        .forEach((other) => {
          if (other !== el) other.hidePopover();
        });
      el.showPopover();
      setShown(true);
      return;
    }
    if (!isOpen) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => {
      el.hidePopover();
      setShown(false);
    }, DROPDOWN_EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // Script-side placement, only where CSS can't do it. Kept in sync while open
  // because the trigger moves with any scrolling ancestor.
  useEffect(() => {
    if (supportsAnchorPositioning || !open) return;
    const el = panelRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    const reposition = () => placePanel(el, anchor, placement);
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, placement]);

  /** Presses inside the panel are the panel's; only the trigger's count. */
  const onTrigger = (e: Event) =>
    !panelRef.current?.contains(e.target as Node | null);

  return (
    <div
      ref={anchorRef}
      class="relative flex"
      style={{ anchorName: idRef.current }}
      onPointerDownCapture={(e) => {
        if (!onTrigger(e)) return;
        openAtPointerDownRef.current = openRef.current;
      }}
      onClickCapture={(e) => {
        const wasOpen = openAtPointerDownRef.current;
        openAtPointerDownRef.current = false;
        if (!wasOpen || !onTrigger(e)) return;
        // The press was meant to close. Keep it from reaching the trigger,
        // which by now may see the panel closed and open it again.
        e.stopPropagation();
        onCloseRef.current();
      }}
    >
      {trigger}
      <div
        ref={panelRef}
        popover="manual"
        data-placement={placement}
        data-open={open ? "true" : undefined}
        data-leaving={leaving ? "true" : undefined}
        inert={leaving}
        class={`dropdown-panel ${panelClass ?? ""}`}
        style={{ positionAnchor: idRef.current }}
      >
        {children}
      </div>
    </div>
  );
}
