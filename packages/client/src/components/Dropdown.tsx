import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

let nextId = 0;

export type DropdownPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end";

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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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

  return (
    <div class="relative flex" style={{ anchorName: idRef.current }}>
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
