import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { animations, editingNoteId } from "../state/index.js";
import {
  isMorphSource,
  MORPH_MS,
  morphIn,
  morphOut,
  type RectLike,
  settle,
  viewportSize,
} from "../utils/morph.js";
import { useFocusTrap } from "./useFocusTrap.js";

/**
 * How long the modal's plain fade runs, either way, where there is no card to
 * morph from; matches its `duration-100` classes and `animate-scale-in`.
 */
const MODAL_CLOSE_MS = 100;

/**
 * How long the card takes to fade (`note-card-transition`). Opening, it fades
 * out as the editor grows off it; closing, it waits so that it fades back in
 * over the end of the morph, as the same fade played backwards.
 */
export const CARD_FADE_MS = 150;

/**
 * A card's editor modal: whether it is up, whether it is on its way down, and
 * whether it grows out of (and shrinks back onto) the card or fades in place.
 *
 * `editingNoteId` is the only thing that decides whether the modal is up, in
 * both directions: setting it opens the modal, clearing it plays the close
 * animation and takes it down. Editing can move elsewhere without going
 * through `closeModal` (a reminder banner opening another note, a
 * notification, a `note:updated` that trashed this one), and the modal must
 * still come down.
 */
export function useCardModal(isEditing: boolean) {
  const [showModal, setShowModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const modalRef = useFocusTrap<HTMLDivElement>(showModal && !closing);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Counts closes and reopens, so a close that finishes after the note was
  // opened again leaves the panel alone.
  const closeRunRef = useRef(0);
  const cardRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Where the editor grows out of, between the effect that opens it and the
  // layout pass that can first measure the panel.
  const morphFromRef = useRef<RectLike | null>(null);
  // Whether the editor is growing out of, or shrinking back onto, the card
  // rather than fading in place. Only where the card can be seen to do it.
  const [morphing, setMorphing] = useState(false);

  /** The card's rectangle, if the editor can be seen to morph to or from it. */
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
        // Reopened while still closing: undo the shrink where it stands. Only
        // then, because this effect runs again as the modal comes up, and
        // settling there would cancel the grow it has just started.
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
      // Reopened since: this close is over, and the panel is staying.
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
      // Down once the morph has landed. The timer is only a backstop, for a
      // tab in the background, where animations are throttled or never run.
      void morphOut(panel, to).then(takeDown);
      closeTimerRef.current = setTimeout(takeDown, MORPH_MS + 250);
    } else {
      closeTimerRef.current = setTimeout(takeDown, MODAL_CLOSE_MS);
    }
  }, [isEditing, showModal, closing, morphSource]);

  // Layout, not effect: the panel's first frame has to be the one over the
  // card, or it paints once in its final place first.
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

  /** Closing is a request to stop editing; the effect above does the rest. */
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
