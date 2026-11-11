import { imageCountOf, type Note, roleOf } from "@manifesto/shared";
import { useComputed } from "@preact/signals";
import clsx from "clsx";
import { memo } from "preact/compat";
import { useContext, useMemo, useRef, useState } from "preact/hooks";
import { autoNoteColorMap, noteColorMap, noteText } from "#/colors.ts";
import { useEditor } from "#/components/editor/lazyEditor.ts";
import { NoteSheet } from "#/components/NoteSheet.tsx";
import { CARD_POPOVER_EXIT_MS } from "#/components/Popover.tsx";
import { useCardModal } from "#/hooks/useCardModal.ts";
import { useNoteImages } from "#/hooks/useNoteImages.ts";
import { usePresence } from "#/hooks/usePresence.ts";
import { useIsTouch, useTouchGesture } from "#/hooks/useTouchGesture.ts";
import { formatDate, t } from "#/i18n/index.ts";
import { leavingNotes, recentlyPinned } from "#/state/actions.ts";
import { drawnWithoutImages } from "#/state/autoNotes.ts";
import { requestDrawing } from "#/state/drawing.ts";
import { openNoteWith } from "#/state/editorIntent.ts";
import { complexShadows, noteSize, viewMode } from "#/state/prefs.ts";
import { enterSelectMode, toggleSelectNote } from "#/state/selection.ts";
import {
  activeView,
  editingNoteId,
  selectedNotes,
  selectMode,
  showError,
} from "#/state/ui.ts";
import { cardName } from "#/utils/cardName.ts";
import { headerImageCount } from "#/utils/inlineImages.ts";
import { contentIsOnlyPreviewUrls } from "#/utils/linkPreview.ts";
import { noteTilt } from "#/utils/noteTilt.ts";
import {
  type CardAction,
  CardRoomContext,
  overflowingActions,
} from "./cardActionsFit.ts";
import { NoteCardBody } from "./NoteCardBody.tsx";
import {
  CardActions,
  CardSelectButton,
  CardStatusBar,
} from "./NoteCardControls.tsx";
import { type CardPopoverKind, NoteCardPopovers } from "./NoteCardPopovers.tsx";
import { NoteReadonlyView } from "./NoteReadonlyView.tsx";

/**
 * One card on the board. It is memoized. It reduces the three board-wide
 * signals that it needs (which note is edited, which are selected, which are
 * leaving) to its own answer before it reads them. When it read the signals
 * themselves, each card subscribed to each change. A click on the select button
 * of one card rendered all of them again, and rendered their markdown again.
 * `ReorderableGrid` keeps the handlers that it gives stable for the same
 * reason. A new closure on each render would defeat the `memo`.
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
  // A note that this user can only read opens without the editor. All other
  // notes wait for it, and stop if the editor cannot load.
  const needsEditor = !note.readonly && roleOf(note) !== "view";
  const editor = useEditor(isEditing && needsEditor, () => {
    if (editingNoteId.peek() === note.id) editingNoteId.value = null;
    showError(t("error.viewUnavailable"));
  });
  const open = isEditing && (!needsEditor || editor !== null);
  const leaving = useComputed(() => leavingNotes.value.get(note.id)).value;
  const isSelectMode = selectMode.value;
  const isSelected = useComputed(() => selectedNotes.value.has(note.id)).value;
  // Read one time at mount. A pin toggle mounted this card again into the other
  // grid. Thus, it must settle in, not show from nowhere. A read during render
  // would also start it again on unrelated renders in the time before the
  // signal clears.
  const [pinSettling, setPinSettling] = useState(
    () => recentlyPinned.peek() === note.id,
  );
  // The editor modal, which only `editingNoteId` opens and closes.
  const {
    showModal,
    closing,
    morphing,
    cardGhost,
    cardHidden,
    cardRef,
    panelRef,
    modalRef,
    closeModal,
    contentReady,
  } = useCardModal(open, needsEditor);
  const [openPopover, setOpenPopover] = useState<CardPopoverKind | null>(null);
  // What is drawn: the open popover, or the popover that just closed while it
  // fades.
  const { shown: shownPopover, leaving: popoverLeaving } = usePresence(
    openPopover,
    CARD_POPOVER_EXIT_MS,
  );
  const togglePopover = (kind: CardPopoverKind) =>
    setOpenPopover(openPopover === kind ? null : kind);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const fontBtnRef = useRef<HTMLButtonElement>(null);
  const tagsBtnRef = useRef<HTMLButtonElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const reminderChipRef = useRef<HTMLButtonElement>(null);
  const reminderBtnRef = useRef<HTMLButtonElement>(null);
  // The reminder picker opens from the element that opened it: the bell on the
  // toolbar, or the own chip of the reminder on the card.
  const [reminderFromChip, setReminderFromChip] = useState(false);
  const toggleReminder = (fromChip: boolean) => {
    setReminderFromChip(fromChip);
    togglePopover("reminder");
  };
  const baseColors = noteColorMap[note.color];
  const autoColors = autoNoteColorMap[note.color];
  const colors = note.readonly
    ? { ...baseColors, bg: autoColors.bg, border: autoColors.border }
    : baseColors;
  const isTrashView = activeView.value === "trash";
  // Shared with this user to read, not to write. It opens as the read-only view
  // does for an automatic note, and you cannot tick its boxes.
  const viewOnly = roleOf(note) === "view";
  const {
    ref: imagesRef,
    images,
    loading: imagesLoading,
  } = useNoteImages<HTMLDivElement>(note);
  // An image that the text shows is not in the header. The card of a plugin
  // that reads notes draws no images in its text, so it keeps all of them.
  const hasImages =
    (drawnWithoutImages(note)
      ? imageCountOf(note)
      : headerImageCount(imageCountOf(note), note.content)) > 0;
  const isImageOnly = hasImages && !note.title && !note.content;
  const hasLinkPreviews = note.linkPreviews.length > 0;
  const isSquare = noteSize.value === "square";
  const isLinkOnly =
    hasLinkPreviews &&
    !note.title &&
    !hasImages &&
    (!note.content.trim() ||
      contentIsOnlyPreviewUrls(note.content, note.linkPreviews));
  // The card is a picture from edge to edge. Thus, its controls are over that
  // picture, not over the own color of the note, at the top and at the bottom.
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

  // If a press on the card does anything. It does not depend on `isEditing`, on
  // purpose. When a focused button goes away, it loses focus. Thus, if a card
  // gave up its tab stop when its own editor opened, the focus trap of the
  // editor would have no element to give focus back to on close. The guard of
  // `handleClick` prevents a second open during an edit, not this one.
  const cardActivates = isSelectMode || !isTrashView;

  // If a press on the card opens the editor, not the read-only view or nothing.
  // The picture, the drawing and the version history rows of the card go to the
  // editor. Thus, they show only where there is one.
  const opensEditor = !isTrashView && !note.readonly && !viewOnly;
  const attachFromCard = (files: File[]) =>
    openNoteWith(note.id, { kind: "attach", files });
  const drawFromCard = () =>
    requestDrawing((file) =>
      openNoteWith(note.id, { kind: "attach", files: [file] }),
    );
  const cardLabel = cardName(note) || t("noteCard.untitled");

  // The same element while its props are the same. Thus, a render of the card
  // for its own state (the card hides when the grow starts, and the sheet goes
  // to its close) does not render the editor again: Preact skips an element
  // that it rendered before. Each of those renders of the full editor cost 3
  // to 5 ms in the task of the click.
  const sheetContent = useMemo(
    () =>
      !needsEditor ? (
        <NoteReadonlyView note={note} onClose={closeModal} />
      ) : (
        editor && (
          <editor.NoteCardEditor
            note={note}
            onClose={closeModal}
            onReady={contentReady}
          />
        )
      ),
    [needsEditor, note, editor, closeModal, contentReady],
  );

  // The buttons of the row that do not fit on this card go into its menu.
  const cardRoom = useContext(CardRoomContext);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rowActions: CardAction[] = opensEditor
    ? ["color", "font", "reminder", "image", "draw", "tags"]
    : ["color", "reminder", "tags"];
  const overflow =
    cardRoom === undefined || isTrashView
      ? []
      : overflowingActions({
          room: cardRoom,
          actions: rowActions,
          leading: note.readonly ? 2 : 0,
          overlay: overlayControls,
        });
  const onOverflow = (action: CardAction) => {
    switch (action) {
      case "reminder":
        setReminderFromChip(false);
        setOpenPopover("reminder");
        return;
      case "image":
        setOpenPopover(null);
        fileInputRef.current?.click();
        return;
      case "draw":
        setOpenPopover(null);
        drawFromCard();
        return;
      default:
        setOpenPopover(action);
    }
  };

  const handleSelectClick = (e: Event) => {
    e.stopPropagation();
    if (isSelectMode) {
      toggleSelectNote(note.id);
    } else {
      enterSelectMode(note.id);
    }
  };

  const isTouch = useIsTouch();
  // If a finger holds this card: it was pressed long enough to lift off the
  // board, and it is now about to be dragged or about to be selected. The tilt
  // is the only sign that the press registered before the reader releases.
  // Thus, it does not depend on the animations preference.
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
          // Not under a card that is lifted (held) with its own shadow. A card
          // that is hidden, or that shows only as a ghost, keeps it in its
          // layout, and hides it (`note-ghost`, `note-morphed`). The shadow
          // reaches below the card. Thus, when it went, a board scrolled to
          // its end moved up at the click.
          complexShadows.value && !held && "note-curl",
          pinSettling && "note-pin-settle",
          leaving && "note-leaving",
          noteSize.value === "square" &&
            viewMode.value === "list" &&
            "w-full max-w-sm mx-auto",
        )}
        data-leaving={leaving}
        // On the wrapper, not the card. Thus, the complex shadow (`note-curl`)
        // reads the same angle as the card.
        style={{ "--note-tilt": `${noteTilt(note.id)}deg` }}
        // A card with one of its menus open keeps the look of a hovered card.
        // The backdrop of the menu covers the card. Thus, the pointer is not
        // over it now, and its buttons faded out under the menu that they
        // opened.
        data-popover-open={openPopover !== null || undefined}
        data-note-id={note.id}
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) setPinSettling(false);
        }}
      >
        {complexShadows.value && (
          <span class="note-curl-shadow" aria-hidden="true" />
        )}
        <CardSelectButton
          isSelected={isSelected}
          isSelectMode={isSelectMode}
          onClick={handleSelectClick}
        />

        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard opens the card through its `[data-card-open]` button, whose click lands here */}
        <article
          ref={cardRef}
          class={clsx(
            colors.bg,
            "note-surface note-finish",
            // The selection is an outline, never a change of border width or
            // ring. Cards have an automatic height, and the masonry grid spans
            // rows from the measured height. Thus, a border that grows by 1px
            // changes the layout of the full column. Outlines are painted
            // outside the border box, and are not part of the layout. Thus, the
            // card stays exactly where it was.
            colors.border,
            !note.readonly && "border",
            // The outline is always present at the same width, and only its
            // color and offset change. Thus, the ring can animate in (it starts
            // a little outside the card, and tightens onto it) under the
            // `note-card-transition` below, and never affects the layout.
            "outline-2",
            isSelected
              ? "outline-blue-500 outline-offset-0"
              : "outline-transparent outline-offset-4",
            // All other changes in 150ms, the color in 300ms. A card with a new
            // color fades into its new sheet, slowly enough to see, while the
            // selection ring and the shadow stay quick.
            "note-card-transition relative select-none overflow-hidden flex flex-col",
            isImageOnly || isLinkOnly
              ? "p-0"
              : !isTrashView
                ? "p-4 pb-2"
                : "p-4",
            complexShadows.value
              ? "note-shadow"
              : "shadow-sm group-hover:shadow-lg group-data-popover-open:shadow-lg",
            // Gone while the editor is drawn over it, because the editor is
            // the card then. Otherwise, a ghost of it, to show where the note
            // is.
            cardHidden && "note-morphed",
            cardGhost && "opacity-20 note-ghost",
            noteSize.value === "square" &&
              viewMode.value === "list" &&
              "w-full",
            draggable && "note-draggable",
            held && "note-held",
            // The cards of a list have the full width of the board, where one
            // degree is a step at the edge. Thus, only the grid leans.
            viewMode.value === "grid" && "note-tilt",
          )}
          style={{
            aspectRatio: noteSize.value === "square" ? "1/1" : "auto",
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
          // A long press is the own gesture of the card on a touch screen. On a
          // link or a picture, Android answers one with a menu, which takes the
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
          data-note-card
          onClick={handleClick}
        >
          {/* What a keyboard or a screen reader presses to open the card. The
              card was itself the button, which hid every control inside it:
              a button's children are presentational, so its pin, colour and
              menu buttons went unannounced or were read twice. Kept while the
              card's own editor is open, or the editor's focus trap would have
              nothing to hand focus back to on close. Its click reaches the
              card's handler; trash cards do not open, so they have none. */}
          {cardActivates && (
            <button
              type="button"
              data-card-open
              class="sr-only"
              aria-pressed={isSelectMode ? isSelected : undefined}
            >
              {cardLabel}
            </button>
          )}
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
            reminderOpen={openPopover === "reminder"}
            onToggleReminder={() => toggleReminder(true)}
          />

          <CardActions
            note={note}
            isTrashView={isTrashView}
            isSelectMode={isSelectMode}
            overlay={overlayControls}
            hidden={overflow}
            fileInputRef={fileInputRef}
            colorBtnRef={colorBtnRef}
            fontBtnRef={fontBtnRef}
            reminderBtnRef={reminderBtnRef}
            tagsBtnRef={tagsBtnRef}
            menuBtnRef={menuBtnRef}
            openPopover={openPopover}
            onToggleColorPicker={() => togglePopover("color")}
            onToggleFontPicker={
              opensEditor ? () => togglePopover("font") : undefined
            }
            onToggleReminder={() => toggleReminder(false)}
            onToggleTags={() => togglePopover("tags")}
            onToggleMenu={() => togglePopover("menu")}
            onAttach={opensEditor ? attachFromCard : undefined}
            onDraw={opensEditor ? drawFromCard : undefined}
          />

          {isTrashView && note.trashedAt && (
            <p class={`mt-2 text-xs ${noteText.quiet}`}>
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
          fontBtnRef={fontBtnRef}
          tagsBtnRef={tagsBtnRef}
          menuBtnRef={menuBtnRef}
          reminderAnchorRef={
            reminderFromChip && note.reminder && !isLinkOnly
              ? reminderChipRef
              : reminderBtnRef
          }
          onShowVersions={
            opensEditor
              ? () => openNoteWith(note.id, { kind: "versions" })
              : undefined
          }
          overflow={overflow}
          onOverflow={onOverflow}
        />
      </div>

      {showModal && (
        <NoteSheet
          label={cardLabel}
          dialogRef={modalRef}
          panelRef={panelRef}
          layer="layer-sheet"
          motion={`transition-all duration-100 ease-in ${morphing ? "" : closing ? "opacity-0 sm:scale-[0.98]" : "max-sm:animate-fade-in sm:animate-scale-in"}`}
          backdrop={
            // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss
            // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss
            <div
              // A light dim, in and out in the short fade, also when the note
              // morphs. A dark dim over the time of the morph changed the full
              // screen while the note grew, and took the eye from the note.
              class={`fixed inset-0 bg-black/30 layer-backdrop max-sm:hidden transition-opacity duration-100 ease-in ${closing ? "opacity-0" : "animate-fade-in"}`}
              onClick={closeModal}
            />
          }
          closing={closing}
          onBack={closeModal}
        >
          {sheetContent}
        </NoteSheet>
      )}
    </>
  );
});
