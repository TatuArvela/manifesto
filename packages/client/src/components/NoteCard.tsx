import {
  imageCountOf,
  type LinkPreview,
  type Note,
  type NoteColor,
} from "@manifesto/shared";
import clsx from "clsx";
import {
  Archive,
  EllipsisVertical,
  Palette,
  Pin,
  PinOff,
  RefreshCw,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { plugins } from "../autoNotes/registry.js";
import { autoNoteColorMap, noteColorMap, noteFontFamilies } from "../colors.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { useNoteImages } from "../hooks/useNoteImages.js";
import { useIsTouch, useTouchGesture } from "../hooks/useTouchGesture.js";
import { formatDate, getColorPickerColors, t } from "../i18n/index.js";
import { refreshAutoNotes } from "../state/autoNotes.js";
import {
  activeView,
  deleteCheckedItems,
  editingNoteId,
  enterSelectMode,
  hasCheckedItems,
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
import { ContentPreview } from "./ContentPreview.js";
import { ImageGallery } from "./ImageGallery.js";
import { LinkPreviewHero } from "./LinkPreviewHero.js";
import { LinkPreviewList } from "./LinkPreviewList.js";
import { NoteCardEditor } from "./NoteCardEditor.js";
import { iconBtnClass } from "./NoteEditor.js";
import { menuPanelClass, NoteMenu, noteMenuItems } from "./NoteMenu.js";
import { NoteReadonlyView } from "./NoteReadonlyView.js";
import { CardPopover } from "./Popover.js";
import { PresenceAvatars } from "./PresenceAvatars.js";
import { ReminderChip } from "./ReminderChip.js";
import { ReminderPickerPanel } from "./ReminderPicker.js";
import { Tooltip } from "./Tooltip.js";

/** How long the modal's fade-out runs; matches its `duration-150` classes. */
const MODAL_CLOSE_MS = 150;

// --- Sub-components ---

function CardColorPicker({
  note,
  anchorRef,
  onClose,
}: {
  note: Note;
  anchorRef: preact.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const pickerColors = getColorPickerColors();
  return (
    <CardPopover anchorRef={anchorRef} onClose={onClose}>
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
}: {
  note: Note;
  anchorRef: preact.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOpenReminder: () => void;
}) {
  return (
    <CardPopover anchorRef={anchorRef} onClose={onClose}>
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
  menuBtnRef,
  onToggleColorPicker,
  onToggleMenu,
}: {
  note: Note;
  isTrashView: boolean;
  isSelectMode: boolean;
  overlay?: boolean;
  colorBtnRef: preact.Ref<HTMLButtonElement>;
  menuBtnRef: preact.Ref<HTMLButtonElement>;
  onToggleColorPicker: () => void;
  onToggleMenu: () => void;
}) {
  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: event stop container */
    /* biome-ignore lint/a11y/useKeyWithClickEvents: event stop container */
    <div
      class={clsx(
        "flex items-center gap-1 transition-opacity",
        overlay
          ? "absolute bottom-0 left-0 right-0 px-2.5 py-2 bg-gradient-to-t from-black/60 to-transparent text-white"
          : "mt-auto pt-3 -ml-1.5",
        isSelectMode
          ? "invisible"
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
              onClick={() => permanentlyDeleteNote(note.id)}
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

export function NoteCard({
  note,
  draggable,
  onDragStart,
  onDragEnd,
  onTouchDragStart,
  onTouchDragMove,
  onTouchDragEnd,
  dropSide,
}: {
  note: Note;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
  onTouchDragStart?: (e: PointerEvent) => void;
  onTouchDragMove?: (e: PointerEvent) => void;
  onTouchDragEnd?: (e: PointerEvent, didDrag: boolean) => void;
  dropSide?: "before" | "after";
}) {
  const isEditing = editingNoteId.value === note.id;
  const isSelectMode = selectMode.value;
  const isSelected = selectedNotes.value.has(note.id);
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
    "color" | "menu" | "reminder" | null
  >(null);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
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
  const {
    ref: imagesRef,
    images,
    loading: imagesLoading,
  } = useNoteImages<HTMLDivElement>(note);
  const hasImages = imageCountOf(note) > 0;
  const isImageOnly = hasImages && !note.title && !note.content;
  const hasLinkPreviews = note.linkPreviews.length > 0;
  const isLinkOnly =
    hasLinkPreviews &&
    !note.title &&
    !hasImages &&
    (!note.content.trim() ||
      contentIsOnlyPreviewUrls(note.content, note.linkPreviews));

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `editingNoteId` is the only thing that decides whether this card's modal is
  // up, in both directions: setting it opens the modal, clearing it plays the
  // close animation and takes it down. The effect used to have no `else`, so
  // anything that moved editing elsewhere without going through `closeModal` (
  // a reminder banner opening another note, a notification, a `note:updated`
  // that trashed this one) left the modal on screen over a note nothing was
  // editing any more, and a second modal could open behind it.
  useEffect(() => {
    if (isEditing) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setShowModal(true);
      setClosing(false);
      return;
    }
    if (!showModal || closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setShowModal(false);
      setClosing(false);
    }, MODAL_CLOSE_MS);
  }, [isEditing, showModal, closing]);

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
  const { onPointerDown: touchPointerDown } = useTouchGesture({
    enabled: isTouch && !isTrashView && !isEditing,
    onLongPress: () => {
      if (selectMode.value) {
        toggleSelectNote(note.id);
      } else {
        enterSelectMode(note.id);
      }
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(10);
        } catch {}
      }
    },
    onDragStart: draggable ? onTouchDragStart : undefined,
    onDragMove: draggable ? onTouchDragMove : undefined,
    onDragEnd: draggable ? onTouchDragEnd : undefined,
  });

  return (
    <>
      <div
        class={clsx(
          "relative group note-draggable-wrapper",
          pinSettling && "note-pin-settle",
          leavingNotes.value.has(note.id) && "note-leaving",
          noteSize.value === "square" &&
            viewMode.value === "list" &&
            "w-full max-w-sm mx-auto",
        )}
        data-drop-side={dropSide}
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
            // `transition-all` below without ever affecting layout.
            "outline-2",
            isSelected
              ? "outline-blue-500 outline-offset-0"
              : "outline-transparent outline-offset-4",
            "transition-all duration-150 relative select-none overflow-hidden flex flex-col",
            isImageOnly || isLinkOnly
              ? "p-0"
              : !isTrashView
                ? "p-4 pb-2"
                : "p-4",
            "shadow-sm group-hover:shadow-lg",
            isEditing && !closing && "opacity-20",
            noteSize.value === "square" &&
              viewMode.value === "list" &&
              "w-full",
            draggable && "note-draggable",
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
          onDragStart={isTouch ? undefined : onDragStart}
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
          role={cardActivates ? "button" : undefined}
          aria-label={cardActivates ? cardLabel : undefined}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (!cardActivates) return;
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
              "absolute top-2 right-2 z-10 flex items-center gap-0.5 text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-neutral-200 group-has-[:focus-visible]:text-neutral-800 dark:group-has-[:focus-visible]:text-neutral-200 touch:text-neutral-800 dark:touch:text-neutral-200 transition-colors duration-200",
              isSelectMode && "invisible",
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
            <div ref={imagesRef} class={isImageOnly ? "" : "-mx-4 -mt-4 mb-3"}>
              {imagesLoading ? (
                // Reserved rather than left empty: the masonry grid measures
                // this card, and a picture arriving afterwards would reflow
                // the column under the reader's hands.
                <div
                  class="w-full bg-black/5 dark:bg-white/5 animate-pulse"
                  style={{ aspectRatio: "4 / 3" }}
                  aria-hidden="true"
                />
              ) : (
                <ImageGallery images={images} />
              )}
            </div>
          )}

          {isLinkOnly ? (
            <>
              <LinkPreviewHero preview={note.linkPreviews[0]} />
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
                  noteSize.value === "square" ? "flex-1 min-h-0" : "max-h-80",
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

              {(note.tags.length > 0 || note.reminder) && (
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
                </div>
              )}
            </>
          )}

          <CardActions
            note={note}
            isTrashView={isTrashView}
            isSelectMode={isSelectMode}
            overlay={isImageOnly || isLinkOnly}
            colorBtnRef={colorBtnRef}
            menuBtnRef={menuBtnRef}
            onToggleColorPicker={() =>
              setOpenPopover(openPopover === "color" ? null : "color")
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

        {openPopover === "color" && (
          <CardColorPicker
            note={note}
            anchorRef={colorBtnRef}
            onClose={() => setOpenPopover(null)}
          />
        )}

        {openPopover === "menu" && (
          <CardMenu
            note={note}
            anchorRef={menuBtnRef}
            onClose={() => setOpenPopover(null)}
            onOpenReminder={() => setOpenPopover("reminder")}
          />
        )}

        {openPopover === "reminder" && (
          <CardPopover
            anchorRef={
              note.reminder && !isLinkOnly ? reminderChipRef : menuBtnRef
            }
            onClose={() => setOpenPopover(null)}
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
              class={`fixed inset-0 bg-black/50 z-40 max-sm:hidden transition-opacity duration-150 ${closing ? "opacity-0" : "animate-fade-in"}`}
              onClick={closeModal}
            />
            <div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-label={note.title || t("editor.titlePlaceholder")}
              class={`fixed inset-0 z-50 flex items-center justify-center sm:p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 sm:scale-95" : "max-sm:animate-fade-in sm:animate-scale-in"}`}
            >
              <div class="pointer-events-auto w-full sm:max-w-2xl sm:max-h-full sm:overflow-y-auto sm:overscroll-contain max-sm:h-full max-sm:overflow-hidden">
                {note.readonly ? (
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
}
