import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { hideAllTooltips } from "./Tooltip.tsx";

let nextId = 0;

export type DropdownPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end"
  /**
   * Next to the trigger, after it, centered on it. Where that goes off the
   * viewport, above the trigger, with its trailing edge on that of the trigger.
   */
  | "inline-end";

/**
 * If the browser can position the panel against its trigger in CSS. Where it
 * can, the stylesheet does all of the placement (also the flip at the edge of
 * the viewport). Where it cannot, `placePanel` below does the same job in
 * script.
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
 * Where the panel must be in relation to its trigger, for browsers without CSS
 * anchor positioning. It does the same as the `position-area` rules: it goes on
 * the requested side of the trigger, flips to the opposite side when there is
 * no space, and stays away from the edges of the viewport in both cases.
 *
 * Pure. Thus, a test can check the geometry without a layout.
 */
export function computePanelPosition(
  anchor: { top: number; bottom: number; left: number; right: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: DropdownPlacement,
): { left: number; top: number } {
  if (placement === "inline-end") {
    return besideTrigger(anchor, panel, viewport);
  }
  const [block, inline] = placement.split("-");

  const below = anchor.bottom + EDGE_GAP;
  const above = anchor.top - panel.height - EDGE_GAP;
  let top = block === "bottom" ? below : above;
  // Flip only when the opposite side really has space. Thus, a panel that is
  // taller than the viewport does not change to a position that is equally bad.
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

  // "start" aligns the leading edge of the panel with that of the trigger,
  // "end" its trailing edge. This agrees with `span-inline-end` /
  // `span-inline-start` in CSS.
  const left = inline === "start" ? anchor.left : anchor.right - panel.width;

  return {
    left: clamp(left, EDGE_GAP, viewport.width - panel.width - EDGE_GAP),
    top: clamp(top, EDGE_GAP, viewport.height - panel.height - EDGE_GAP),
  };
}

/** `inline-end`, as the fallback of `@position-try --dd-above-end` in CSS. */
function besideTrigger(
  anchor: { top: number; bottom: number; left: number; right: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const beside = anchor.right + EDGE_GAP;
  if (beside + panel.width <= viewport.width - EDGE_GAP) {
    const middle = (anchor.top + anchor.bottom) / 2 - panel.height / 2;
    return {
      left: beside,
      top: clamp(middle, EDGE_GAP, viewport.height - panel.height - EDGE_GAP),
    };
  }
  const above = anchor.top - panel.height - EDGE_GAP;
  const top = above >= EDGE_GAP ? above : anchor.bottom + EDGE_GAP;
  return {
    left: clamp(
      anchor.right - panel.width,
      EDGE_GAP,
      viewport.width - panel.width - EDGE_GAP,
    ),
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
 * How long a panel takes to leave: the duration of the `.dropdown-panel`
 * transition.
 */
export const DROPDOWN_EXIT_MS = 140;

/**
 * A generic dropdown built on the Popover API and CSS anchor positioning. Thus,
 * the panel renders in the top layer, and an ancestor with `overflow: hidden`
 * does not clip it.
 *
 * The popover is `manual`. This component dismisses it (outside presses,
 * Escape), and decides when it leaves the top layer: only after its exit
 * animation is complete. With `popover="auto"`, the browser hid the panel
 * immediately at the dismissal. The exit could only show where the top layer
 * itself can transition (`overlay`, only in Chromium). In other browsers, the
 * panel dropped out from over the page, and was cut off or drawn under the
 * header while it faded.
 *
 * Before it opens, the component asks each other open dropdown panel to close,
 * through its `toggle` event. Neither the auto-popover stack of the browser nor
 * a tracker at module level was reliable across the modal portal. Thus, the
 * code queries the DOM.
 *
 * A `persistent` panel is a bar to work from, not a menu to select from. A
 * press outside it does not close it, and another dropdown that opens (for
 * example, one inside it) does not close it. It stays until its trigger is
 * pressed again, or until Escape.
 */
export function Dropdown({
  open,
  onClose,
  trigger,
  children,
  panelClass,
  placement = "bottom-start",
  persistent = false,
}: {
  open: boolean;
  onClose: () => void;
  trigger: ComponentChildren;
  children: ComponentChildren;
  panelClass?: string | undefined;
  placement?: DropdownPlacement;
  persistent?: boolean;
}) {
  const idRef = useRef("");
  if (!idRef.current) idRef.current = `--dd-${++nextId}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openRef = useRef(open);
  openRef.current = open;
  // If the panel is in the top layer, which lasts longer than `open` by the
  // exit. The render calculates `leaving`. An effect does not set it. An effect
  // runs after a frame in which the panel is not open and not leaving, and the
  // `display: none` of that frame cancelled the exit before it started.
  const [shown, setShown] = useState(false);
  const leaving = !open && shown;
  // If the panel was open when the pointer last went down on the trigger. A tap
  // delivers its click as a separate gesture, after an outside press already
  // closed the panel. Thus, the trigger would see it closed, and open it again.
  // The menu could not be closed from its own button.
  const openAtPointerDownRef = useRef(false);

  useEscapeStack(open, () => onCloseRef.current());

  // When a different dropdown opens, it closes this one: it hides its popover,
  // which arrives here as `toggle`. Only reported while this panel must be
  // open, because its own exit also ends with a hide.
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

  // A press anywhere other than the panel and its trigger dismisses it, as the
  // light-dismiss of the browser did. The press on the trigger goes to the
  // trigger, which toggles.
  useEffect(() => {
    if (!open || persistent) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, persistent]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const isOpen = el.matches(":popover-open");
    if (open) {
      if (isOpen) return; // Opened again during the exit: it transitions back.
      // If not, the own tooltip of the trigger would be on top of the panel
      // that will open, because the pointer never leaves the trigger. Thus,
      // nothing hides it.
      hideAllTooltips();
      document
        .querySelectorAll<HTMLElement>(
          ".dropdown-panel:popover-open:not([data-persistent])",
        )
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

  // The trigger tells if its panel is open, for all dropdowns at the same time.
  // Each caller does not have to remember it (most callers had not). Also, a
  // panel that closes with focus in it gives focus back to the trigger. The
  // render reads where the focus was, before the commit makes the panel inert.
  // Chromium moves focus out of inert content to the page before an effect
  // runs.
  const focusWasInPanel = useRef(false);
  if (!open && panelRef.current?.contains(document.activeElement)) {
    focusWasInPanel.current = true;
  }
  useEffect(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    const button = [
      ...(anchor?.querySelectorAll<HTMLElement>("button") ?? []),
    ].find((b) => !panel?.contains(b));
    button?.setAttribute("aria-expanded", String(open));
    if (!open && focusWasInPanel.current) button?.focus();
    focusWasInPanel.current = false;
  }, [open]);

  // Placement in script, only where CSS cannot do it. It updates while open,
  // because the trigger moves with each ancestor that scrolls.
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

  /**
   * Presses inside the panel belong to the panel. Only those of the trigger
   * count.
   */
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
        // The press was to close. Keep it from the trigger, which possibly sees
        // the panel closed now and would open it again.
        e.stopPropagation();
        onCloseRef.current();
      }}
    >
      {trigger}
      <div
        ref={panelRef}
        popover="manual"
        data-placement={placement}
        data-persistent={persistent ? "true" : undefined}
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
