import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { animations } from "#/state/prefs.ts";
import { editingNoteId } from "#/state/ui.ts";
import {
  isMorphSource,
  MORPH_MS,
  morphIn,
  morphOut,
  type RectLike,
  settle,
  viewportSize,
} from "#/utils/morph.ts";
import { useFocusTrap } from "./useFocusTrap.ts";

/**
 * The duration of the plain fade of the modal, in both directions, where there
 * is no card from which to morph. It agrees with its `duration-100` classes and
 * `animate-scale-in`.
 */
const MODAL_CLOSE_MS = 100;

/**
 * How long the card takes to fade (`note-card-transition`). At the open, it
 * fades out while the editor grows off it. At the close, it waits, so that it
 * fades back in over the end of the morph, as the same fade played backwards.
 */
export const CARD_FADE_MS = 150;

/**
 * The editor modal of a card: if it is open, if it is closing, and if it grows
 * out of (and shrinks back onto) the card or fades in place.
 *
 * `editingNoteId` is the only thing that decides if the modal is open, in both
 * directions. When you set it, the modal opens. When you clear it, the close
 * animation plays and the modal goes. Editing can move to a different note
 * without `closeModal` (a reminder banner that opens a different note, a
 * notification, a `note:updated` that put this note in the trash), and the
 * modal must still close.
 */
export function useCardModal(isEditing: boolean) {
  const [showModal, setShowModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const modalRef = useFocusTrap<HTMLDivElement>(showModal && !closing);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Counts closes and opens. Thus, a close that completes after the note opened
  // again does not change the panel.
  const closeRunRef = useRef(0);
  const cardRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The element out of which the editor grows, between the effect that opens it
  // and the layout pass that can first measure the panel.
  const morphFromRef = useRef<RectLike | null>(null);
  // If the editor grows out of, or shrinks back onto, the card, and does not
  // fade in place. Only where you can see the card.
  const [morphing, setMorphing] = useState(false);

  /**
   * The rectangle of the card, if you can see the editor morph to or from it.
   */
  const morphSource = useCallback((): RectLike | null => {
    if (!animations.peek()) return null;
    const rect = cardRef.current?.getBoundingClientRect();
    return isMorphSource(rect, viewportSize()) ? rect : null;
  }, []);

  useEffect(() => {
    if (isEditing) {
      closeRunRef.current++;
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (closing) {
        // Opened again while it still closes: undo the shrink where it is. Only
        // then, because this effect runs again when the modal opens, and a
        // settle there would cancel the grow that it just started.
        if (panelRef.current) settle(panelRef.current);
      } else if (!showModal) {
        morphFromRef.current = morphSource();
        setMorphing(morphFromRef.current !== null);
      }
      setShowModal(true);
      setClosing(false);
      return;
    }
    if (!showModal || closing) return;
    const run = ++closeRunRef.current;
    const takeDown = () => {
      // Opened again after that: this close is complete, and the panel stays.
      if (run !== closeRunRef.current) return;
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      setShowModal(false);
      setClosing(false);
    };
    const panel = panelRef.current;
    const to = panel ? morphSource() : null;
    setMorphing(to !== null);
    setClosing(true);
    if (panel && to) {
      // Down after the morph is complete. The timer is only a backstop, for a
      // tab in the background, where animations are throttled or never run.
      void morphOut(panel, to).then(takeDown);
      closeTimerRef.current = setTimeout(takeDown, MORPH_MS + 250);
    } else {
      closeTimerRef.current = setTimeout(takeDown, MODAL_CLOSE_MS);
    }
  }, [isEditing, showModal, closing, morphSource]);

  // Layout, not effect. The first frame of the panel must be the frame over the
  // card. If not, it paints one time in its final position first.
  useLayoutEffect(() => {
    const from = morphFromRef.current;
    const panel = panelRef.current;
    if (!showModal || !from || !panel) return;
    morphFromRef.current = null;
    morphIn(panel, from);
  }, [showModal]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  /** A close is a request to stop editing. The effect above does the rest. */
  const closeModal = () => {
    editingNoteId.value = null;
  };

  return {
    showModal,
    closing,
    morphing,
    cardRef,
    panelRef,
    modalRef,
    closeModal,
  };
}
