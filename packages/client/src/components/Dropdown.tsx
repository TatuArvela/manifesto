import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
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
  // trailing edge — matching `span-inline-end` / `span-inline-start` in CSS.
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

/**
 * Generic dropdown built on the Popover API + CSS anchor positioning, so the
 * panel renders in the top layer and is not clipped by ancestor
 * `overflow: hidden`. Uses `popover="auto"` so the browser light-dismisses
 * on outside taps and Escape. Before opening, any other open dropdown panel
 * is hidden explicitly — neither the browser's auto-popover stack mutex nor a
 * module-level tracker proved reliable across the modal portal, so we query
 * the DOM for currently-open panels and close them.
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

  // Closed here rather than left to the Popover API's own Escape handling: with
  // focus inside the editor's ProseMirror, Chromium does not run the
  // light-dismiss (measured), so relying on it would make Escape do nothing at
  // all now that the layer underneath correctly stands aside. `hidePopover` on
  // an already-hidden panel is a no-op, so the browser is welcome to get there
  // first; either way the `toggle` listener above reports the close upward.
  useEscapeStack(open, () => panelRef.current?.hidePopover());

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const handleToggle = (e: Event) => {
      const newState = (e as unknown as { newState: string }).newState;
      if (newState === "closed") onCloseRef.current();
    };
    el.addEventListener("toggle", handleToggle);
    return () => el.removeEventListener("toggle", handleToggle);
  }, []);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const isOpen = el.matches(":popover-open");
    if (open && !isOpen) {
      // The trigger's own tooltip would otherwise sit on top of the panel we
      // are about to open — the pointer never leaves the trigger, so nothing
      // hides it.
      hideAllTooltips();
      // Explicitly hide any other open dropdown panel before opening this one.
      document
        .querySelectorAll<HTMLElement>(".dropdown-panel:popover-open")
        .forEach((other) => {
          if (other !== el) other.hidePopover();
        });
      el.showPopover();
    } else if (!open && isOpen) {
      el.hidePopover();
    }
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

  return (
    <div
      ref={anchorRef}
      class="relative flex"
      style={{ anchorName: idRef.current }}
    >
      {trigger}
      <div
        ref={panelRef}
        popover="auto"
        data-placement={placement}
        data-open={open ? "true" : undefined}
        class={`dropdown-panel ${panelClass ?? ""}`}
        style={{ positionAnchor: idRef.current }}
      >
        {children}
      </div>
    </div>
  );
}
