import type { LinkPreview, Note, NoteColor } from "@manifesto/shared";
import clsx from "clsx";
import {
  Archive,
  ArchiveRestore,
  Bell,
  Copy,
  EllipsisVertical,
  Link,
  Palette,
  Pin,
  PinOff,
  Tag,
  Trash2,
  Undo2,
  X,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "../colors.js";
import { formatDate, getColorPickerColors, t } from "../i18n/index.js";
import { buildShareUrl } from "../sharing.js";
import {
  activeView,
  archiveNote,
  createNote,
  editingNoteId,
  enterSelectMode,
  noteSize,
  permanentlyDeleteNote,
  restoreNote,
  selectedNotes,
  selectMode,
  toggleCheckbox,
  togglePin,
  toggleSelectNote,
  trashNote,
  unarchiveNote,
  updateNote,
  viewMode,
} from "../state/index.js";
import { showSuccess } from "../state/ui.js";
import { extractUrls } from "../utils/linkPreview.js";
import { ContentPreview } from "./ContentPreview.js";
import { ImageGallery } from "./ImageGallery.js";
import { LinkPreviewHero } from "./LinkPreviewHero.js";
import { LinkPreviewList } from "./LinkPreviewList.js";
import { NoteCardEditor } from "./NoteCardEditor.js";
import { iconBtnClass } from "./NoteEditor.js";
import { CardPopover } from "./Popover.js";
import { ReminderChip } from "./ReminderChip.js";
import { ReminderPickerPanel } from "./ReminderPicker.js";
import { TagPicker } from "./TagPicker.js";
import { Tooltip } from "./Tooltip.js";

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
      <div class="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 flex gap-1">
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
}: {
  note: Note;
  anchorRef: preact.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);

  return (
    <CardPopover
      anchorRef={anchorRef}
      onClose={() => {
        setShowTagPicker(false);
        setShowReminderPicker(false);
        onClose();
      }}
    >
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-48 py-1">
        {/* Tags */}
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
            onClick={() => setShowTagPicker(!showTagPicker)}
          >
            <Tag class="w-4 h-4" />
            {t("noteCard.menu.tags")}
          </button>
          {showTagPicker && (
            <TagPicker
              tags={note.tags}
              onAddTag={(tag) => {
                if (!note.tags.includes(tag)) {
                  updateNote(note.id, {
                    tags: [...note.tags, tag],
                  });
                }
              }}
            />
          )}
        </div>

        {/* Reminder */}
        <div class="relative">
          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
            onClick={() => setShowReminderPicker(!showReminderPicker)}
          >
            <Bell class="w-4 h-4" />
            {t("noteCard.menu.reminder")}
          </button>
          {showReminderPicker && (
            <div class="px-3 py-2">
              <ReminderPickerPanel
                reminder={note.reminder}
                onChange={(reminder) => updateNote(note.id, { reminder })}
                onDone={() => {
                  setShowReminderPicker(false);
                  onClose();
                }}
              />
            </div>
          )}
        </div>

        {/* Duplicate */}
        <button
          type="button"
          class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          onClick={() => {
            createNote({
              title: note.title,
              content: note.content,
              color: note.color,
              font: note.font,
              tags: [...note.tags],
            });
            onClose();
          }}
        >
          <Copy class="w-4 h-4" />
          {t("noteCard.menu.duplicate")}
        </button>

        {/* Share link */}
        <button
          type="button"
          class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          onClick={() => {
            const url = buildShareUrl({
              title: note.title,
              content: note.content,
              color: note.color,
              font: note.font,
              tags: [...note.tags],
            });
            navigator.clipboard.writeText(url);
            showSuccess(t("noteCard.linkCopied"));
            onClose();
          }}
        >
          <Link class="w-4 h-4" />
          {t("noteCard.menu.shareLink")}
        </button>
        <button
          type="button"
          class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          onClick={() => {
            if (note.archived) {
              unarchiveNote(note.id);
            } else {
              archiveNote(note.id);
            }
            onClose();
          }}
        >
          {note.archived ? (
            <ArchiveRestore class="w-4 h-4" />
          ) : (
            <Archive class="w-4 h-4" />
          )}
          {note.archived
            ? t("noteCard.menu.unarchive")
            : t("noteCard.menu.archive")}
        </button>
        <div class="my-1 border-t border-gray-200 dark:border-gray-700" />
        <button
          type="button"
          class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          onClick={() => {
            if (note.trashed) {
              restoreNote(note.id);
            } else {
              trashNote(note.id);
            }
            onClose();
          }}
        >
          {note.trashed ? (
            <Undo2 class="w-4 h-4" />
          ) : (
            <Trash2 class="w-4 h-4" />
          )}
          {note.trashed
            ? t("noteCard.menu.undelete")
            : t("noteCard.menu.delete")}
        </button>
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
        isSelectMode ? "invisible" : "opacity-0 group-hover:opacity-100",
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
          <Tooltip label={t("noteCard.more")}>
            <button
              ref={menuBtnRef}
              type="button"
              class={iconBtnClass}
              onClick={onToggleMenu}
              aria-label={t("noteCard.moreOptions")}
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
  // Strip URLs and any surrounding markdown syntax (autolinks, link wrappers) —
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
  dropSide,
}: {
  note: Note;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
  dropSide?: "before" | "after";
}) {
  const isEditing = editingNoteId.value === note.id;
  const isSelectMode = selectMode.value;
  const isSelected = selectedNotes.value.has(note.id);
  const [showModal, setShowModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [openPopover, setOpenPopover] = useState<
    "color" | "menu" | "reminder" | null
  >(null);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const reminderChipRef = useRef<HTMLButtonElement>(null);
  const colors = noteColorMap[note.color];
  const isTrashView = activeView.value === "trash";
  const hasImages = note.images.length > 0;
  const isImageOnly = hasImages && !note.title && !note.content;
  const hasLinkPreviews = note.linkPreviews.length > 0;
  const isLinkOnly =
    hasLinkPreviews &&
    !note.title &&
    !hasImages &&
    (!note.content.trim() ||
      contentIsOnlyPreviewUrls(note.content, note.linkPreviews));

  // Show modal when editing starts
  useEffect(() => {
    if (isEditing) {
      setShowModal(true);
      setClosing(false);
    }
  }, [isEditing]);

  const closeModal = () => {
    setClosing(true);
    setTimeout(() => {
      setShowModal(false);
      setClosing(false);
      editingNoteId.value = null;
    }, 150);
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

  const handleSelectClick = (e: Event) => {
    e.stopPropagation();
    if (isSelectMode) {
      toggleSelectNote(note.id);
    } else {
      enterSelectMode(note.id);
    }
  };

  return (
    <>
      <div
        class={clsx(
          "relative group",
          noteSize.value === "square" &&
            viewMode.value === "list" &&
            "w-full max-w-sm mx-auto",
        )}
      >
        {/* Selection checkbox */}
        {!isTrashView && (
          <div
            class={clsx(
              "absolute -top-2.5 -left-2.5 z-10",
              isSelectMode || isSelected
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100",
              "transition-opacity duration-200",
            )}
          >
            <button
              type="button"
              class={clsx(
                "w-5 h-5 rounded-full flex items-center justify-center transition-all shadow-sm",
                isSelected
                  ? "bg-blue-500 text-white hover:bg-blue-600"
                  : "bg-white dark:bg-gray-200 text-gray-400 hover:bg-gray-100 dark:hover:bg-white hover:scale-110 border border-gray-300",
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
        )}

        <article
          class={clsx(
            colors.bg,
            isSelected
              ? "ring-2 ring-blue-500 border-transparent"
              : colors.border,
            "border transition-all duration-150 relative select-none overflow-hidden flex flex-col",
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
          draggable={draggable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          data-drop-side={dropSide}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleClick();
          }}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: event stop container */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: event stop container */}
          <div
            class={clsx(
              "absolute top-2 right-2 flex items-center gap-0.5 text-gray-400 dark:text-gray-500 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors duration-200",
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
                  class={`${iconBtnClass} ${note.pinned ? "opacity-100 group/pin" : "opacity-0 group-hover:opacity-100"} transition-opacity`}
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
          </div>

          {hasImages && (
            <div class={isImageOnly ? "" : "-mx-4 -mt-4 mb-3"}>
              <ImageGallery images={note.images} />
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
                class={clsx(
                  noteSize.value === "square" &&
                    "flex-1 min-h-0 overflow-hidden note-content-fade",
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
                      class="inline-block px-2 py-0.5 text-xs rounded-full bg-gray-200/60 dark:bg-gray-700/60"
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
            <p class="mt-2 text-xs text-gray-400">
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
          />
        )}

        {openPopover === "reminder" && (
          <CardPopover
            anchorRef={reminderChipRef}
            onClose={() => setOpenPopover(null)}
          >
            <div class="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-72">
              <ReminderPickerPanel
                reminder={note.reminder}
                onChange={(reminder) => updateNote(note.id, { reminder })}
                onDone={() => setOpenPopover(null)}
              />
            </div>
          </CardPopover>
        )}
      </div>

      {showModal && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
          <div
            class={`fixed inset-0 bg-black/50 z-20 transition-opacity duration-150 ${closing ? "opacity-0" : "animate-fade-in"}`}
            onClick={closeModal}
          />
          <div
            class={`fixed inset-0 z-30 flex items-center justify-center p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 scale-95" : "animate-scale-in"}`}
          >
            <div class="pointer-events-auto w-full max-w-2xl">
              <NoteCardEditor note={note} onClose={closeModal} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
