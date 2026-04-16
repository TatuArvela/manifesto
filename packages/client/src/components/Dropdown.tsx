import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";

/**
 * A generic dropdown with a fixed backdrop for dismiss.
 * Renders the trigger inline and the panel absolutely positioned.
 * Closes on Escape key and backdrop click.
 */
export function Dropdown({
  open,
  onClose,
  trigger,
  children,
  panelClass,
}: {
  open: boolean;
  onClose: () => void;
  trigger: ComponentChildren;
  children: ComponentChildren;
  panelClass?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  return (
    <div class="relative flex">
      {trigger}
      {open && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
          <div
            class="fixed inset-0 z-10"
            role="presentation"
            onClick={onClose}
            onKeyDown={() => {}}
          />
          <div
            class={
              panelClass ??
              "absolute right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20"
            }
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}
