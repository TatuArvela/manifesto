import type { ComponentChildren, RefObject } from "preact";
import { createContext, createPortal } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { useBackToClose } from "../hooks/useBackToClose.js";
import { openSheet } from "../utils/phoneSheets.js";

interface NoteSheetProps {
  /** The dialog's accessible name. */
  label: string;
  /** The focus trap's ref, which goes on the dialog. */
  dialogRef: RefObject<HTMLDivElement | null>;
  /** The panel the note is drawn in, which a morph animates. */
  panelRef?: RefObject<HTMLDivElement | null>;
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
 * Where a sheet's content may put something beside the panel on a wide
 * screen (`SHEET_ASIDE_QUERY`), such as a note's comments: an element to
 * portal into, to the right of the panel, as tall as it. Null outside a
 * sheet. Empty, it takes no room and the panel sits centred alone. What goes
 * in takes the class `sheet-aside-panel`: the aside widens to make room as it
 * arrives, so the panel slides aside rather than jumping, and closes up again
 * as it leaves.
 */
export const SheetAside = createContext<HTMLElement | null>(null);

/** The widths with room for the aside. Matches its `max-lg:hidden`. */
export const SHEET_ASIDE_QUERY = "(min-width: 64rem)";

/**
 * How long what is in the aside takes to leave, held there by `usePresence`
 * and marked `data-leaving`; `sheet-aside-out` in styles/editor.css.
 */
export const SHEET_ASIDE_EXIT_MS = 200;

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
  }, [dialogRef]);

  useBackToClose(!closing, onBack);

  const [aside, setAside] = useState<HTMLElement | null>(null);

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
        {/* The panel and what is beside it, centred as one. The panel's
            height is the dialog's less its padding, said outright because a
            percentage has nothing to measure against in a row this tall. */}
        <div class="w-full sm:flex sm:items-start sm:justify-center">
          <div
            ref={panelRef ?? null}
            class="note-sheet-panel pointer-events-auto w-full sm:min-w-0 sm:max-w-2xl sm:max-h-[calc(100dvh-2rem)] sm:overflow-y-auto sm:overscroll-contain"
          >
            <SheetAside.Provider value={aside}>{children}</SheetAside.Provider>
          </div>
          <div
            ref={setAside}
            class={`sheet-aside pointer-events-auto relative shrink-0 self-stretch max-lg:hidden ${closing ? "opacity-0" : ""}`}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
