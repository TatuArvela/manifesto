import {
  imageCountOf,
  type LinkPreview,
  type Note,
  type NoteColor,
  roleOf,
} from "@manifesto/shared";
import { useComputed } from "@preact/signals";
import clsx from "clsx";
import {
  Archive,
  EllipsisVertical,
  Palette,
  Pin,
  PinOff,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  X,
} from "lucide-preact";
import { createPortal, memo } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { plugins } from "../autoNotes/registry.js";
import { autoNoteColorMap, noteColorMap, noteFontFamilies } from "../colors.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { useNoteImages } from "../hooks/useNoteImages.js";
import { usePresence } from "../hooks/usePresence.js";
import { useIsTouch, useTouchGesture } from "../hooks/useTouchGesture.js";
import { formatDate, getColorPickerColors, t } from "../i18n/index.js";
import { refreshAutoNotes } from "../state/autoNotes.js";
import { confirmDeletion } from "../state/confirm.js";
import {
  activeView,
  addTag,
  animations,
  deleteCheckedItems,
  editingNoteId,
  enterSelectMode,
  leavingNotes,
  noteSize,
  permanentlyDeleteNote,
  recentlyPinned,
  restoreNote,
  selectedNotes,
  selectMode,
  toggleCheckbox,
  togglePin,
  toggleSelectNote,
  updateNote,
  viewMode,
} from "../state/index.js";
import { extractUrls } from "../utils/linkPreview.js";
import { hasCheckedItems } from "../utils/markdown.js";
import {
  isMorphSource,
  MORPH_MS,
  morphIn,
  morphOut,
  type RectLike,
  settle,
  viewportSize,
} from "../utils/morph.js";
import { ContentPreview } from "./ContentPreview.js";
import { ImageGallery } from "./ImageGallery.js";
import { LinkPreviewHero } from "./LinkPreviewHero.js";
import { LinkPreviewList } from "./LinkPreviewList.js";
import { NoteCardEditor } from "./NoteCardEditor.js";
import { iconBtnClass } from "./NoteEditor.js";
import { menuPanelClass, NoteMenu, noteMenuItems } from "./NoteMenu.js";
import { NoteReadonlyView } from "./NoteReadonlyView.js";
import { CARD_POPOVER_EXIT_MS, CardPopover } from "./Popover.js";
import { PresenceAvatars } from "./PresenceAvatars.js";
import { ReminderChip } from "./ReminderChip.js";
import { ReminderPickerPanel } from "./ReminderPicker.js";
import { SharedAvatars } from "./SharedAvatars.js";
import { TagPicker, tagPickerPanelClass } from "./TagPicker.js";
import { Tooltip } from "./Tooltip.js";

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
const CARD_FADE_MS = 150;

// --- Sub-components ---

function CardColorPicker({
  note,
  anchorRef,
  onClose,
  leaving,
}: {
  note: Note;
  anchorRef: preact.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  leaving: boolean;
}) {
  const pickerColors = getColorPickerColors();
  return (
    <CardPopover anchorRef={anchorRef} onClose={onClose} leaving={leaving}>
      <div class="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1">
        {pickerColors.map((c) => (
          <Tooltip key={c.value} label={c.label}>
            <button
              type="button"
              class={`w-6 h-6 rounded-full cursor-pointer ${c.swatch} ${note.color === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
              onClick={() => {
                updateNote(note.id, { color: c.value as NoteColor });
                onClose();
              }}
              aria-label={c.label}
            />
          </Tooltip>
        ))}
      </div>
    </CardPopover>
  );
}

function CardMenu({
  note,
  anchorRef,
  onClose,
  onOpenReminder,
  leaving,
}: {
  note: Note;
  anchorRef: preact.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOpenReminder: () => void;
  leaving: boolean;
}) {
  return (
    <CardPopover anchorRef={anchorRef} onClose={onClose} leaving={leaving}>
      <div class={menuPanelClass}>
        <NoteMenu
          items={noteMenuItems(note, {
            onOpenReminder,
            checkedItems: {
              present: hasCheckedItems(note.content),
              remove: () => deleteCheckedItems(note.id),
            },
          })}
          onClose={onClose}
        />
      </div>
    </CardPopover>
  );
}

function CardActions({
  note,
  isTrashView,
  isSelectMode,
  overlay,
  colorBtnRef,
  tagsBtnRef,
  menuBtnRef,
  onToggleColorPicker,
  onToggleTags,
  onToggleMenu,
}: {
  note: Note;
  isTrashView: boolean;
  isSelectMode: boolean;
  overlay?: boolean;
  colorBtnRef: preact.Ref<HTMLButtonElement>;
  tagsBtnRef: preact.Ref<HTMLButtonElement>;
  menuBtnRef: preact.Ref<HTMLButtonElement>;
  onToggleColorPicker: () => void;
  onToggleTags: () => void;
  onToggleMenu: () => void;
}) {
  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: event stop container */
    /* biome-ignore lint/a11y/useKeyWithClickEvents: event stop container */
    <div
      class={clsx(
        "flex items-center gap-1 transition-[opacity,visibility]",
        overlay
          ? "absolute bottom-0 left-0 right-0 px-2.5 py-2 bg-gradient-to-t from-black/60 to-transparent text-white"
          : "mt-auto pt-3 -ml-1.5",
        isSelectMode
          ? "invisible opacity-0"
          : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 touch:opacity-100",
      )}
      onClick={(e) => {
        if (e.target !== e.currentTarget) e.stopPropagation();
      }}
    >
      {isTrashView ? (
        <>
          <Tooltip label={t("noteCard.restore")}>
            <button
              type="button"
              class={iconBtnClass}
              onClick={() => restoreNote(note.id)}
              aria-label={t("noteCard.restoreNote")}
            >
              <Undo2 class="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label={t("noteCard.deletePermanently")}>
            <button
              type="button"
              class={iconBtnClass}
              onClick={async () => {
                const ok = await confirmDeletion({
                  title: t("confirm.delete.title"),
                  body: t("confirm.delete.body"),
                  confirmLabel: t("confirm.delete.action"),
                });
                if (ok) permanentlyDeleteNote(note.id);
              }}
              aria-label={t("noteCard.deletePermanently")}
            >
              <X class="w-4 h-4" />
            </button>
          </Tooltip>
        </>
      ) : (
        <>
          {note.readonly && (
            <>
              <Tooltip
                label={t("autoNotes.generatedBy", {
                  name:
                    plugins.value.find((p) => p.id === note.source?.pluginId)
                      ?.name ??
                    note.source?.pluginId ??
                    "",
                })}
              >
                <span
                  class="p-1.5 opacity-60"
                  role="img"
                  aria-label={t("autoNotes.badge")}
                >
                  <Sparkles class="w-4 h-4" />
                </span>
              </Tooltip>
              <Tooltip label={t("autoNotes.refresh")}>
                <button
                  type="button"
                  class={iconBtnClass}
                  onClick={() => refreshAutoNotes()}
                  aria-label={t("autoNotes.refresh")}
                >
                  <RefreshCw class="w-4 h-4" />
                </button>
              </Tooltip>
            </>
          )}
          <Tooltip label={t("noteCard.color")}>
            <button
              ref={colorBtnRef}
              type="button"
              class={iconBtnClass}
              onClick={onToggleColorPicker}
              aria-label={t("noteCard.changeColor")}
            >
              <Palette class="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label={t("noteMenu.tags")}>
            <button
              ref={tagsBtnRef}
              type="button"
              class={iconBtnClass}
              onClick={onToggleTags}
              aria-label={t("noteMenu.tags")}
            >
              <Tag class="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label={t("noteMenu.more")}>
            <button
              ref={menuBtnRef}
              type="button"
              class={iconBtnClass}
              onClick={onToggleMenu}
              aria-label={t("noteMenu.moreOptions")}
            >
              <EllipsisVertical class="w-4 h-4" />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

function contentIsOnlyPreviewUrls(
  content: string,
  previews: LinkPreview[],
): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const contentUrls = extractUrls(trimmed);
  if (contentUrls.length === 0) return false;
  const previewUrls = new Set(previews.map((p) => p.url));
  if (!contentUrls.every((u) => previewUrls.has(u))) return false;
  // Strip URLs and any surrounding markdown syntax (autolinks, link wrappers);
  // if nothing meaningful remains, treat it as link-only.
  let remaining = trimmed;
  for (const u of contentUrls) remaining = remaining.split(u).join("");
  return remaining.replace(/[<>[\]()\s`*_]/g, "") === "";
}

// --- Main component ---

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
  const [showModal, setShowModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const modalRef = useFocusTrap<HTMLDivElement>(showModal && !closing);
  const [openPopover, setOpenPopover] = useState<
    "color" | "tags" | "menu" | "reminder" | null
  >(null);
  // What is drawn: the open popover, or the one just closed while it fades.
  const { shown: shownPopover, leaving: popoverLeaving } = usePresence(
    openPopover,
    CARD_POPOVER_EXIT_MS,
  );
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const tagsBtnRef = useRef<HTMLButtonElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const reminderChipRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentClipped, setContentClipped] = useState(false);
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
  const morphSource = (): RectLike | null => {
    if (!animations.peek()) return null;
    const rect = cardRef.current?.getBoundingClientRect();
    return isMorphSource(rect, viewportSize()) ? rect : null;
  };

  // `editingNoteId` is the only thing that decides whether this card's modal is
  // up, in both directions: setting it opens the modal, clearing it plays the
  // close animation and takes it down. Editing can move elsewhere without going
  // through `closeModal` (a reminder banner opening another note, a
  // notification, a `note:updated` that trashed this one), and the modal must
  // still come down.
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
  }, [isEditing, showModal, closing]);

  // Layout, not effect: the panel's first frame has to be the one over the
  // card, or it paints once in its final place first.
  useLayoutEffect(() => {
    const from = morphFromRef.current;
    const panel = panelRef.current;
    if (!showModal || !from || !panel) return;
    morphFromRef.current = null;
    morphIn(panel, from);
  }, [showModal]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) {
      setContentClipped(false);
      return;
    }
    const update = () => setContentClipped(el.scrollHeight > el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [note.title, note.content, images.length, note.linkPreviews.length]);

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
        <div
          class={clsx(
            "note-select absolute -top-2.5 -left-2.5 z-10",
            // Revealed by keyboard focus anywhere in the card as well as by
            // hover: these controls are in the tab order either way, and a
            // focus ring on something invisible leaves nothing to look at.
            isSelectMode || isSelected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100",
            "transition-opacity duration-200",
          )}
        >
          <button
            type="button"
            class={clsx(
              "w-5 h-5 rounded-full flex items-center justify-center transition-all shadow-sm",
              isSelected
                ? "bg-blue-500 text-white hover:bg-blue-600"
                : "bg-white dark:bg-neutral-200 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white hover:scale-110 border border-neutral-300",
            )}
            onClick={handleSelectClick}
            aria-label={
              isSelected ? t("noteCard.deselect") : t("noteCard.select")
            }
          >
            {isSelected && (
              <svg
                class="w-3 h-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        </div>

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
          {/* biome-ignore lint/a11y/noStaticElementInteractions: event stop container */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: event stop container */}
          <div
            class={clsx(
              "absolute top-2 right-2 z-10 flex items-center gap-0.5 transition-[color,opacity,visibility] duration-200",
              // A card whose whole face is an image or a link hero has no
              // note colour up here to darken against, and the picture
              // underneath can be any shade, so the icons go white with a
              // shadow of their own rather than joining the neutral ramp.
              overlayControls
                ? "text-white [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.7))]"
                : "text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-neutral-200 group-has-[:focus-visible]:text-neutral-800 dark:group-has-[:focus-visible]:text-neutral-200 touch:text-neutral-800 dark:touch:text-neutral-200",
              // Faded rather than switched, both ways. Visibility is in the
              // transition so it waits for the fade out, and still hides the
              // buttons from Tab once it has finished.
              isSelectMode && "invisible opacity-0",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {!isTrashView && (
              <Tooltip
                label={note.pinned ? t("noteCard.unpin") : t("noteCard.pin")}
              >
                <button
                  type="button"
                  class={`${iconBtnClass} ${note.pinned ? "opacity-100 group/pin" : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 touch:opacity-100"} transition-opacity`}
                  onClick={() => togglePin(note.id)}
                  aria-label={
                    note.pinned ? t("noteCard.unpin") : t("noteCard.pin")
                  }
                >
                  {note.pinned ? (
                    <span class="relative block w-4 h-4">
                      <Pin class="w-4 h-4 absolute inset-0 transition-opacity duration-200 group-hover/pin:opacity-0" />
                      <PinOff class="w-4 h-4 absolute inset-0 transition-opacity duration-200 opacity-0 group-hover/pin:opacity-100" />
                    </span>
                  ) : (
                    <Pin class="w-4 h-4" />
                  )}
                </button>
              </Tooltip>
            )}
            {note.archived && (
              <Tooltip label={t("noteCard.archived")}>
                <span class="p-1.5 opacity-60">
                  <Archive class="w-4 h-4" />
                </span>
              </Tooltip>
            )}
            {note.trashed && (
              <Tooltip label={t("noteCard.trashed")}>
                <span class="p-1.5 opacity-60">
                  <Trash2 class="w-4 h-4" />
                </span>
              </Tooltip>
            )}
            <PresenceAvatars noteId={note.id} />
          </div>

          {hasImages && (
            <div
              ref={imagesRef}
              class={
                isImageOnly
                  ? isSquare
                    ? "flex-1 min-h-0"
                    : ""
                  : "-mx-4 -mt-4 mb-3"
              }
            >
              {imagesLoading ? (
                // Reserved rather than left empty: the masonry grid measures
                // this card, and a picture arriving afterwards would reflow
                // the column under the reader's hands.
                <div
                  class={`w-full bg-black/5 dark:bg-white/5 animate-pulse ${isImageOnly && isSquare ? "h-full" : ""}`}
                  style={
                    isImageOnly && isSquare
                      ? undefined
                      : { aspectRatio: "4 / 3" }
                  }
                  aria-hidden="true"
                />
              ) : (
                <ImageGallery images={images} fill={isImageOnly && isSquare} />
              )}
            </div>
          )}

          {isLinkOnly ? (
            <>
              <LinkPreviewHero preview={note.linkPreviews[0]} fill={isSquare} />
              {note.linkPreviews.length > 1 && (
                <div class="p-3">
                  <LinkPreviewList
                    previews={note.linkPreviews.slice(1)}
                    variant="card"
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <div
                ref={contentRef}
                class={clsx(
                  "overflow-hidden",
                  contentClipped && "note-content-fade",
                  // With nothing to show, an image-only note's text block
                  // must not stretch too, or it takes half of a square card
                  // from the images.
                  isSquare && !isImageOnly ? "flex-1 min-h-0" : "max-h-80",
                )}
                style={{ fontFamily: noteFontFamilies[note.font] || undefined }}
              >
                {note.title && (
                  <h3 class="font-medium text-base leading-snug pr-6">
                    {note.title}
                  </h3>
                )}

                <ContentPreview
                  note={note}
                  onCheckboxToggle={(lineIndex) =>
                    toggleCheckbox(note.id, lineIndex)
                  }
                  hasTitle={!!note.title}
                  readOnly={viewOnly}
                />
              </div>

              {hasLinkPreviews && (
                <div class="mt-3">
                  <LinkPreviewList
                    previews={note.linkPreviews}
                    variant="card"
                  />
                </div>
              )}

              {(note.tags.length > 0 || note.reminder || note.sharing) && (
                <div class="mt-3 flex flex-wrap gap-1 items-center">
                  {note.reminder && (
                    <ReminderChip
                      reminder={note.reminder}
                      anchorRef={reminderChipRef}
                      onClick={() =>
                        setOpenPopover(
                          openPopover === "reminder" ? null : "reminder",
                        )
                      }
                      onClear={() => updateNote(note.id, { reminder: null })}
                    />
                  )}
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      class="inline-block px-2 py-0.5 text-xs rounded-full bg-neutral-200/60 dark:bg-neutral-700/60"
                    >
                      #{tag}
                    </span>
                  ))}
                  {note.sharing && (
                    <span class="ml-auto pl-1">
                      <SharedAvatars note={note} />
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          <CardActions
            note={note}
            isTrashView={isTrashView}
            isSelectMode={isSelectMode}
            overlay={overlayControls}
            colorBtnRef={colorBtnRef}
            tagsBtnRef={tagsBtnRef}
            menuBtnRef={menuBtnRef}
            onToggleColorPicker={() =>
              setOpenPopover(openPopover === "color" ? null : "color")
            }
            onToggleTags={() =>
              setOpenPopover(openPopover === "tags" ? null : "tags")
            }
            onToggleMenu={() =>
              setOpenPopover(openPopover === "menu" ? null : "menu")
            }
          />

          {isTrashView && note.trashedAt && (
            <p class="mt-2 text-xs text-neutral-400">
              {t("noteCard.trashedAt", { date: formatDate(note.trashedAt) })}
            </p>
          )}
        </article>

        {shownPopover === "color" && (
          <CardColorPicker
            note={note}
            anchorRef={colorBtnRef}
            onClose={() => setOpenPopover(null)}
            leaving={popoverLeaving}
          />
        )}

        {shownPopover === "tags" && (
          <CardPopover
            anchorRef={tagsBtnRef}
            onClose={() => setOpenPopover(null)}
            leaving={popoverLeaving}
          >
            <div class={tagPickerPanelClass}>
              <TagPicker
                tags={note.tags}
                autoFocus
                onAddTag={(tag) => addTag(note.id, tag)}
              />
            </div>
          </CardPopover>
        )}

        {shownPopover === "menu" && (
          <CardMenu
            note={note}
            anchorRef={menuBtnRef}
            // Only if the menu is still what is open: the menu closes itself
            // after every item, and "Remind me" has by then handed over to
            // the reminder picker, which a plain close took down with it.
            onClose={() =>
              setOpenPopover((open) => (open === "menu" ? null : open))
            }
            onOpenReminder={() => setOpenPopover("reminder")}
            leaving={popoverLeaving}
          />
        )}

        {shownPopover === "reminder" && (
          <CardPopover
            anchorRef={
              note.reminder && !isLinkOnly ? reminderChipRef : menuBtnRef
            }
            onClose={() => setOpenPopover(null)}
            leaving={popoverLeaving}
          >
            <div class="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 w-72">
              <ReminderPickerPanel
                reminder={note.reminder}
                onChange={(reminder) => updateNote(note.id, { reminder })}
                onDone={() => setOpenPopover(null)}
              />
            </div>
          </CardPopover>
        )}
      </div>

      {showModal &&
        createPortal(
          <>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
            <div
              // In and out over the same time as the panel: the morph's
              // when it morphs, the plain fade's otherwise.
              class={`fixed inset-0 bg-black/50 z-40 max-sm:hidden transition-opacity ease-in ${morphing ? "duration-240" : "duration-100"} ${closing ? "opacity-0" : morphing ? "animate-[fade-in_240ms_ease-out]" : "animate-fade-in"}`}
              onClick={closeModal}
            />
            <div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-label={note.title || t("editor.titlePlaceholder")}
              class={`phone-sheet fixed inset-0 z-50 flex items-center justify-center sm:p-4 pointer-events-none transition-all duration-100 ease-in ${morphing ? "" : closing ? "opacity-0 sm:scale-[0.98]" : "max-sm:animate-fade-in sm:animate-scale-in"}`}
            >
              <div
                ref={panelRef}
                class="pointer-events-auto w-full sm:max-w-2xl sm:max-h-full sm:overflow-y-auto sm:overscroll-contain max-sm:h-full max-sm:overflow-hidden"
              >
                {note.readonly || viewOnly ? (
                  <NoteReadonlyView note={note} onClose={closeModal} />
                ) : (
                  <NoteCardEditor note={note} onClose={closeModal} />
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
});
