import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";

let nextId = 0;

// Only show focus-triggered tooltips when the user is actually navigating
// with a keyboard. Otherwise a tap on a button would focus it and leave the
// tooltip stuck open (no mouseleave follows a tap on iOS).
let lastInputKeyboard = false;
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
