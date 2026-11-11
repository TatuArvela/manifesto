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
  settle,
  stopMorph,
  viewportSize,
} from "#/utils/morph.ts";
import type { RectLike } from "#/utils/morphPath.ts";
import { useFocusTrap } from "./useFocusTrap.ts";

/**
 * The duration of the plain fade of the modal, in both directions, where there
 * is no card from which to morph. It agrees with its `duration-100` classes and
 * `animate-scale-in`.
 */
const MODAL_CLOSE_MS = 100;

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
export function useCardModal(isEditing: boolean, waitsForContent: boolean) {
  const [showModal, setShowModal] = useState(false);
  const [closing, setClosing] = useState(false);
  // The editor takes focus after the first paint, and its first frames show
  // the card, not its controls. Thus, the trap moves focus in only after that,
  // and only if the editor did not take it (on a phone, where it does not).
  const modalRef = useFocusTrap<HTMLDivElement>(showModal && !closing, {
    focusInAfterPaint: true,
  });
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Counts closes and opens. Thus, a close that completes after the note opened
  // again does not change the panel.
  const closeRunRef = useRef(0);
  const cardRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The card out of which the editor grows, and its shadow, between the effect
  // that opens it and the layout pass that can first measure the panel. Both
  // are read at the click, while the board is laid out and the sheet is not
  // there yet. A read of the shadow after the sheet mounted made the browser
  // calculate the style of the full sheet for it.
  const morphFromRef = useRef<{
    rect: RectLike;
    shadow: string | undefined;
  } | null>(null);
  // If the editor grows out of, or shrinks back onto, the card, and does not
  // fade in place. Only where you can see the card.
  const [morphing, setMorphing] = useState(false);
  // A grow that waits over the card for the text of the editor. The card stays
  // until it starts. If the card went at the open, the screen was empty there
  // while the grow waited.
  const [growHeld, setGrowHeld] = useState(false);

  /**
   * The rectangle of the card, if you can see the editor morph to or from it.
   */
  const morphSource = useCallback((): RectLike | null => {
    if (!animations.peek()) return null;
    const rect = cardRef.current?.getBoundingClientRect();
    return isMorphSource(rect, viewportSize()) ? rect : null;
  }, []);

  /**
   * The shadow of the card. The panel starts with it and lands with it, and
   * has its own shadow between. Thus, the shadow does not change at once when
   * the card and the panel change places.
   */
  const cardShadow = useCallback((): string | undefined => {
    const card = cardRef.current;
    return card ? getComputedStyle(card).boxShadow : undefined;
  }, []);

  // Layout, not effect. Preact runs an effect only after the next paint. Thus,
  // each open waited one frame before the sheet mounted, and each close one
  // frame before the shrink started, with nothing new on the screen in that
  // frame. Here, the sheet mounts and the shrink starts in the task of the
  // click.
  useLayoutEffect(() => {
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
        const rect = morphSource();
        morphFromRef.current = rect && { rect, shadow: cardShadow() };
        setMorphing(rect !== null);
        setGrowHeld(rect !== null && waitsForContent);
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
      void morphOut(panel, to, {
        shadow: cardShadow(),
        standIn: cardRef.current,
      }).then(takeDown);
      closeTimerRef.current = setTimeout(takeDown, MORPH_MS + 250);
    } else if (panel && !stopMorph(panel)) {
      // A grow that still waited never showed, and the card is still there.
      // Thus, the sheet goes at once, as after `morphOut`.
      queueMicrotask(takeDown);
    } else {
      // The grow stops where the panel is laid out, and the sheet fades. If
      // it went on, a held grow could start during the fade, and its plates
      // were drawn in the scale of the fading dialog.
      closeTimerRef.current = setTimeout(takeDown, MODAL_CLOSE_MS);
    }
  }, [isEditing, showModal, closing, morphSource, cardShadow, waitsForContent]);

  // What lets a grow that waits for the editor start (`contentReady`).
  const startGrowRef = useRef<(() => void) | null>(null);

  // Layout, not effect. The first frame of the panel must be the frame over the
  // card. If not, it paints one time in its final position first. A grow that
  // waits for the editor measures the panel only when the editor is there.
  useLayoutEffect(() => {
    const from = morphFromRef.current;
    const panel = panelRef.current;
    if (!showModal || !from || !panel) return;
    morphFromRef.current = null;
    const ready = waitsForContent
      ? new Promise<void>((resolve) => {
          startGrowRef.current = resolve;
        })
      : undefined;
    morphIn(panel, from.rect, {
      opaque: true,
      ready,
      onStart: () => setGrowHeld(false),
      shadow: from.shadow,
      standIn: cardRef.current,
    });
  }, [showModal, waitsForContent]);

  /**
   * The editor in the panel has its text. A grow waits for this, because the
   * editor builds its view after the panel mounts (see `morphIn`). Usually in
   * the same task: the editor builds and reports in layout effects, and
   * Milkdown creates its view in microtasks. Thus, the grow usually starts on
   * the first frame after the click.
   */
  const contentReady = useCallback(() => {
    startGrowRef.current?.();
    startGrowRef.current = null;
  }, []);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  /**
   * A close is a request to stop editing. The effect above does the rest.
   * Stable, because the card keeps the content of the sheet from one render to
   * the next while its props are the same.
   */
  const closeModal = useCallback(() => {
    editingNoteId.value = null;
  }, []);

  return {
    showModal,
    closing,
    morphing,
    // A ghost of the card shows where the note is, when the editor does not
    // grow out of it. From the same render as the modal: `isEditing` comes one
    // render before `morphing`. Thus, a ghost from `isEditing` was a ghost for
    // that render also before a grow, and the card lost its shadow at the click.
    cardGhost: showModal && !closing && !morphing,
    // The card is the panel while the panel is drawn over it, from the start
    // of the grow to the end of the shrink. Nothing fades: the panel covers
    // the card exactly at both ends, and the card hides and shows at once.
    cardHidden: showModal && morphing && !growHeld,
    cardRef,
    panelRef,
    modalRef,
    closeModal,
    contentReady,
  };
}
