import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

/** Renders children in a fixed-position portal above the anchor button. */
export function CardPopover({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: preact.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPos({ top: rect.top, left: rect.left });
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
      <div class="fixed inset-0 z-40" onClick={onClose} />
      {pos && (
        <div
          ref={popoverRef}
          class="fixed z-50"
          style={{
            top: `${pos.top}px`,
            left: `${pos.left}px`,
            transform: "translateY(-100%) translateY(-4px)",
          }}
        >
          {children}
        </div>
      )}
    </>,
    document.body,
  );
}
