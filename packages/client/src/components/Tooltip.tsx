import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";

let nextId = 0;

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

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      popoverRef.current?.showPopover();
    }, 200);
  };

  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    popoverRef.current?.hidePopover();
  };

  return (
    <span
      class="inline-flex items-center"
      style={{ anchorName: idRef.current }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      <div
        ref={popoverRef}
        popover="manual"
        class="tooltip"
        style={{ positionAnchor: idRef.current }}
      >
        {label}
      </div>
    </span>
  );
}
