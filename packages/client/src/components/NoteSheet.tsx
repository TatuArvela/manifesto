import type { ComponentChildren, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect } from "preact/hooks";
import { useBackToClose } from "../hooks/useBackToClose.js";
import { openSheet } from "../utils/phoneSheets.js";

interface NoteSheetProps {
  /** The dialog's accessible name. */
  label: string;
  /** The focus trap's ref, which goes on the dialog. */
  dialogRef: RefObject<HTMLDivElement>;
  /** The panel the note is drawn in, which a morph animates. */
  panelRef?: RefObject<HTMLDivElement>;
  /** Its stacking layer: `z-50`, or `z-[70]` over another sheet. */
  layer: string;
  /** The open and close transitions, which each caller times its own way. */
  motion: string;
  /** The dimmed layer behind a wider screen's dialog. */
  backdrop: ComponentChildren;
  /** Playing its exit: the browser's back no longer reaches it. */
  closing: boolean;
  /** What the browser's back does. */
  onBack: () => void;
  children: ComponentChildren;
}

/**
 * A note (or its history) opened over the board: a centred dialog on a wider
 * screen and the whole screen on a phone, where it is laid out in the page
 * rather than fixed over it (see `utils/phoneSheets.ts` for why), and where
 * back closes it.
 */
export function NoteSheet({
  label,
  dialogRef,
  panelRef,
  layer,
  motion,
  backdrop,
  closing,
  onBack,
  children,
}: NoteSheetProps) {
  // Layout, not effect: the page has to be arranged around the sheet before
  // its first frame, or it paints once over a board that then jumps.
  useLayoutEffect(() => {
    const el = dialogRef.current;
    return el ? openSheet(el) : undefined;
  }, []);

  useBackToClose(!closing, onBack);

  return createPortal(
    <>
      {backdrop}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        class={`note-sheet ${layer} sm:fixed sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-4 pointer-events-none ${motion}`}
      >
        <div
          ref={panelRef}
          class="pointer-events-auto w-full sm:max-w-2xl sm:max-h-full sm:overflow-y-auto sm:overscroll-contain"
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}
