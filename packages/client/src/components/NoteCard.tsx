import { imageCountOf, type Note, roleOf } from "@manifesto/shared";
import { useComputed } from "@preact/signals";
import clsx from "clsx";
import { memo } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import { autoNoteColorMap, noteColorMap } from "../colors.js";
import { CARD_FADE_MS, useCardModal } from "../hooks/useCardModal.js";
import { useNoteImages } from "../hooks/useNoteImages.js";
import { usePresence } from "../hooks/usePresence.js";
import { useIsTouch, useTouchGesture } from "../hooks/useTouchGesture.js";
import { formatDate, t } from "../i18n/index.js";
import {
  activeView,
  editingNoteId,
  enterSelectMode,
  leavingNotes,
  noteSize,
  recentlyPinned,
  selectedNotes,
  selectMode,
  toggleSelectNote,
  viewMode,
} from "../state/index.js";
import { contentIsOnlyPreviewUrls } from "../utils/linkPreview.js";
import { MORPH_MS } from "../utils/morph.js";
import { NoteCardBody } from "./NoteCardBody.js";
import {
  CardActions,
  CardSelectButton,
  CardStatusBar,
} from "./NoteCardControls.js";
import { NoteCardEditor } from "./NoteCardEditor.js";
import { type CardPopoverKind, NoteCardPopovers } from "./NoteCardPopovers.js";
import { NoteReadonlyView } from "./NoteReadonlyView.js";
import { NoteSheet } from "./NoteSheet.js";
import { CARD_POPOVER_EXIT_MS } from "./Popover.js";

/**
 * One card on the board. Memoized, and it derives the three board-wide
 * signals it cares about (which note is being edited, which are selected,
 * which are leaving) down to its own answer before reading them. Reading the
 * signals themselves subscribed every card to every change: a click on one
 * card's select button re-rendered, and re-rendered the markdown of, all of
 * them. `ReorderableGrid` keeps the handlers it passes stable for the same
 * reason; a new closure per render would defeat the `memo`.
 */
export const NoteCard = memo(function NoteCard({
  note,
  draggable,
  onDragStart,
  onDragEnd,
  onTouchDragStart,
  onTouchDragMove,
  onTouchDragEnd,
}: {
  note: Note;
  draggable?: boolean;
  onDragStart?: (e: DragEvent, id: string) => void;
  onDragEnd?: (e: DragEvent) => void;
  onTouchDragStart?: (e: PointerEvent, id: string) => void;
  onTouchDragMove?: (e: PointerEvent) => void;
  onTouchDragEnd?: (e: PointerEvent, didDrag: boolean) => void;
}) {
  const isEditing = useComputed(() => editingNoteId.value === note.id).value;
  const leaving = useComputed(() => leavingNotes.value.get(note.id)).value;
  const isSelectMode = selectMode.value;
  const isSelected = useComputed(() => selectedNotes.value.has(note.id)).value;
  // Read once at mount: this card was remounted into the other grid by a pin
  // toggle, so it should settle in rather than appear from nowhere. Reading it
  // during render would also re-trigger on unrelated re-renders in the window
  // before the signal clears.
  const [pinSettling, setPinSettling] = useState(
    () => recentlyPinned.peek() === note.id,
  );
  // The editor modal, which `editingNoteId` alone opens and closes.
  const {
    showModal,
    closing,
    morphing,
    cardRef,
    panelRef,
    modalRef,
    closeModal,
  } = useCardModal(isEditing);
  const [openPopover, setOpenPopover] = useState<CardPopoverKind | null>(null);
  // What is drawn: the open popover, or the one just closed while it fades.
  const { shown: shownPopover, leaving: popoverLeaving } = usePresence(
    openPopover,
    CARD_POPOVER_EXIT_MS,
  );
  const togglePopover = (kind: CardPopoverKind) =>
    setOpenPopover(openPopover === kind ? null : kind);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const tagsBtnRef = useRef<HTMLButtonElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const reminderChipRef = useRef<HTMLButtonElement>(null);
  const baseColors = noteColorMap[note.color];
  const autoColors = autoNoteColorMap[note.color];
  const colors = note.readonly
    ? { ...baseColors, bg: autoColors.bg, border: autoColors.border }
    : baseColors;
  const isTrashView = activeView.value === "trash";
  // Shared with this user to read, not to write: it opens as the read-only
  // view does for an automatic note, and its boxes cannot be ticked.
  const viewOnly = roleOf(note) === "view";
  const {
    ref: imagesRef,
    images,
    loading: imagesLoading,
  } = useNoteImages<HTMLDivElement>(note);
  const hasImages = imageCountOf(note) > 0;
  const isImageOnly = hasImages && !note.title && !note.content;
  const hasLinkPreviews = note.linkPreviews.length > 0;
  const isSquare = noteSize.value === "square";
  const isLinkOnly =
    hasLinkPreviews &&
    !note.title &&
    !hasImages &&
    (!note.content.trim() ||
      contentIsOnlyPreviewUrls(note.content, note.linkPreviews));
  // The card is a picture edge to edge, so its controls sit over that picture
  // instead of over the note's own colour, at the top and at the bottom alike.
  const overlayControls = isImageOnly || isLinkOnly;

  const handleClick = () => {
    if (isSelectMode) {
      toggleSelectNote(note.id);
      return;
    }
    if (!isTrashView && !isEditing) {
      editingNoteId.value = note.id;
    }
  };

  // Whether pressing the card does anything. Deliberately not conditioned on
  // `isEditing`: dropping `tabindex` from the focused element blurs it, so a
  // card that gave up its tab stop the moment its own editor opened would
  // leave the editor's focus trap with nothing to hand focus back to on close.
  // Reopening while already editing is `handleClick`'s guard, not this one's.
  const cardActivates = isSelectMode || !isTrashView;
  const cardLabel = isSelectMode
    ? note.title || t("noteCard.select")
    : note.title || t("editor.titlePlaceholder");

  const handleSelectClick = (e: Event) => {
    e.stopPropagation();
    if (isSelectMode) {
      toggleSelectNote(note.id);
    } else {
      enterSelectMode(note.id);
    }
  };

  const isTouch = useIsTouch();
  // Whether a finger is holding this card: it has been pressed long enough to
  // have lifted off the board, and is now either about to be dragged or about
  // to be selected. The tilt is the only sign the press registered before the
  // reader lets go, so it is not gated on the animations preference.
  const [held, setHeld] = useState(false);
  const { onPointerDown: touchPointerDown } = useTouchGesture({
    enabled: isTouch && !isTrashView && !isEditing,
    onHold: () => {
      setHeld(true);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(10);
        } catch {}
      }
    },
    onHoldEnd: () => setHeld(false),
    onLongPress: () => {
      if (selectMode.value) {
        toggleSelectNote(note.id);
      } else {
        enterSelectMode(note.id);
      }
    },
    onDragStart:
      draggable && onTouchDragStart
        ? (e) => onTouchDragStart(e, note.id)
        : undefined,
    onDragMove: draggable ? onTouchDragMove : undefined,
    onDragEnd: draggable ? onTouchDragEnd : undefined,
  });

  return (
    <>
      <div
        class={clsx(
          "relative group note-draggable-wrapper",
          pinSettling && "note-pin-settle",
          leaving && "note-leaving",
          noteSize.value === "square" &&
            viewMode.value === "list" &&
            "w-full max-w-sm mx-auto",
        )}
        data-leaving={leaving}
        data-note-id={note.id}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) setPinSettling(false);
        }}
      >
        <CardSelectButton
          isSelected={isSelected}
          isSelectMode={isSelectMode}
          onClick={handleSelectClick}
        />

        <article
          ref={cardRef}
          class={clsx(
            colors.bg,
            "note-surface",
            // Selection is an outline, never a border-width or ring change:
            // cards are auto-height and the masonry grid spans rows from the
            // measured height, so growing the border by 1px reflows the whole
            // column. Outlines are painted outside the border box and take no
            // part in layout, so the card stays exactly where it was.
            colors.border,
            !note.readonly && "border",
            // The outline is always present at the same width and only its
            // colour and offset change, so the ring can animate in (it draws
            // from slightly outside the card and tightens onto it) under the
            // `note-card-transition` below without ever affecting layout.
            "outline-2",
            isSelected
              ? "outline-blue-500 outline-offset-0"
              : "outline-transparent outline-offset-4",
            // Everything else in 150ms, the colour in 300ms: a recoloured
            // card fades into its new sheet, slowly enough to be seen, while
            // the selection ring and shadow stay quick.
            "note-card-transition relative select-none overflow-hidden flex flex-col",
            isImageOnly || isLinkOnly
              ? "p-0"
              : !isTrashView
                ? "p-4 pb-2"
                : "p-4",
            "shadow-sm group-hover:shadow-lg",
            // Gone while it morphs into the editor, since the editor is it;
            // a ghost of it otherwise, to show where the note lives.
            isEditing && !closing && (morphing ? "opacity-0" : "opacity-20"),
            noteSize.value === "square" &&
              viewMode.value === "list" &&
              "w-full",
            draggable && "note-draggable",
            held && "note-held",
          )}
          style={{
            aspectRatio: noteSize.value === "square" ? "1/1" : "auto",
            transitionDelay:
              closing && morphing ? `${MORPH_MS - CARD_FADE_MS}ms` : undefined,
          }}
          draggable={!isTouch && draggable}
          onPointerDown={(e) => {
            if (isTouch) {
              touchPointerDown(e);
            } else if (draggable) {
              document.body.classList.add("note-drag-active");
            }
          }}
          onPointerUp={() => {
            if (!isTouch) document.body.classList.remove("note-drag-active");
          }}
          // A long press is the card's own gesture on a touch screen. Android
          // answers one on a link or picture with a menu, which takes the
          // touch and cancels the hold under it.
          onContextMenu={isTouch ? (e) => e.preventDefault() : undefined}
          onDragStart={
            isTouch || !onDragStart ? undefined : (e) => onDragStart(e, note.id)
          }
          onDragEnd={
            isTouch
              ? undefined
              : (e) => {
                  document.body.classList.remove("note-drag-active");
                  onDragEnd?.(e);
                }
          }
          // A card is the primary control of the grid and was reachable only
          // with a pointer: no tab stop, and an Enter handler on an element
          // nothing could focus. Trash cards do not open, so they are a plain
          // article carrying buttons rather than something to activate.
          tabIndex={cardActivates ? 0 : undefined}
          data-note-card
          role={cardActivates ? "button" : undefined}
          aria-label={cardActivates ? cardLabel : undefined}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (!cardActivates) return;
            // Only keys aimed at the card itself. Enter on a link or a button
            // inside it bubbles here too, and cancelling it stopped that link
            // or button from ever activating.
            if (e.target !== e.currentTarget) return;
            if (e.key !== "Enter" && e.key !== " ") return;
            // Space scrolls the page by default, and both would otherwise also
            // reach whatever the click opens.
            e.preventDefault();
            handleClick();
          }}
        >
          <CardStatusBar
            note={note}
            isTrashView={isTrashView}
            isSelectMode={isSelectMode}
            overlay={overlayControls}
          />

          <NoteCardBody
            note={note}
            imagesRef={imagesRef}
            images={images}
            imagesLoading={imagesLoading}
            hasImages={hasImages}
            isImageOnly={isImageOnly}
            isLinkOnly={isLinkOnly}
            isSquare={isSquare}
            viewOnly={viewOnly}
            reminderChipRef={reminderChipRef}
            onToggleReminder={() => togglePopover("reminder")}
          />

          <CardActions
            note={note}
            isTrashView={isTrashView}
            isSelectMode={isSelectMode}
            overlay={overlayControls}
            colorBtnRef={colorBtnRef}
            tagsBtnRef={tagsBtnRef}
            menuBtnRef={menuBtnRef}
            onToggleColorPicker={() => togglePopover("color")}
            onToggleTags={() => togglePopover("tags")}
            onToggleMenu={() => togglePopover("menu")}
          />

          {isTrashView && note.trashedAt && (
            <p class="mt-2 text-xs text-neutral-400">
              {t("noteCard.trashedAt", { date: formatDate(note.trashedAt) })}
            </p>
          )}
        </article>

        <NoteCardPopovers
          note={note}
          shown={shownPopover}
          leaving={popoverLeaving}
          setOpen={setOpenPopover}
          colorBtnRef={colorBtnRef}
          tagsBtnRef={tagsBtnRef}
          menuBtnRef={menuBtnRef}
          reminderAnchorRef={
            note.reminder && !isLinkOnly ? reminderChipRef : menuBtnRef
          }
        />
      </div>

      {showModal && (
        <NoteSheet
          label={note.title || t("editor.titlePlaceholder")}
          dialogRef={modalRef}
          panelRef={panelRef}
          layer="z-50"
          motion={`transition-all duration-100 ease-in ${morphing ? "" : closing ? "opacity-0 sm:scale-[0.98]" : "max-sm:animate-fade-in sm:animate-scale-in"}`}
          backdrop={
            // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss
            // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss
            <div
              // In and out over the same time as the panel: the morph's
              // when it morphs, the plain fade's otherwise.
              class={`fixed inset-0 bg-black/50 z-40 max-sm:hidden transition-opacity ease-in ${morphing ? "duration-240" : "duration-100"} ${closing ? "opacity-0" : morphing ? "animate-[fade-in_240ms_ease-out]" : "animate-fade-in"}`}
              onClick={closeModal}
            />
          }
          closing={closing}
          onBack={closeModal}
        >
          {note.readonly || viewOnly ? (
            <NoteReadonlyView note={note} onClose={closeModal} />
          ) : (
            <NoteCardEditor note={note} onClose={closeModal} />
          )}
        </NoteSheet>
      )}
    </>
  );
});
