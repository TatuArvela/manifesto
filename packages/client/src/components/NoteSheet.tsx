import type { ComponentChildren, RefObject } from "preact";
import { createContext, createPortal } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { useBackToClose } from "#/hooks/useBackToClose.ts";
import { openSheet } from "#/utils/phoneSheets.ts";

interface NoteSheetProps {
  /** The accessible name of the dialog. */
  label: string;
  /** The ref of the focus trap, which goes on the dialog. */
  dialogRef: RefObject<HTMLDivElement | null>;
  /** The panel in which the note is drawn, which a morph animates. */
  panelRef?: RefObject<HTMLDivElement | null>;
  /**
   * Its stacking layer: `layer-sheet`, or `layer-nested` over a different
   * sheet.
   */
  layer: string;
  /** The open and close transitions, which each caller times in its own way. */
  motion: string;
  /** The dimmed layer behind the dialog on a wider screen. */
  backdrop: ComponentChildren;
  /** In its exit animation: the back of the browser does not reach it now. */
  closing: boolean;
  /** What the back of the browser does. */
  onBack: () => void;
  children: ComponentChildren;
}

/**
 * Where the content of a sheet can put something next to the panel on a wide
 * screen (`SHEET_ASIDE_QUERY`), for example the comments of a note: an element
 * to portal into, to the right of the panel, with the same height. Null outside
 * a sheet. When it is empty, it uses no space, and the panel is alone in the
 * center. Content that goes in uses the class `sheet-aside-panel`. The aside
 * becomes wider to make space when the content arrives. Thus, the panel slides
 * aside, and does not jump. It becomes narrower again when the content leaves.
 */
export const SheetAside = createContext<HTMLElement | null>(null);

/** The widths with space for the aside. They agree with its `max-lg:hidden`. */
export const SHEET_ASIDE_QUERY = "(min-width: 64rem)";

/**
 * How long the content of the aside takes to leave. `usePresence` keeps it
 * there and marks it `data-leaving`. `sheet-aside-out` in styles/editor.css.
 */
export const SHEET_ASIDE_EXIT_MS = 200;

/**
 * A note (or its history) opened over the board: a centered dialog on a wider
 * screen, and the full screen on a phone. On a phone, it is in the layout of
 * the page, not fixed over it (see `utils/phoneSheets.ts` for the reason), and
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
  // Layout, not effect. The page must be arranged around the sheet before its
  // first frame. If not, it paints one time over a board that then jumps.
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
