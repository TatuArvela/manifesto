import type { Note, NoteColor } from "@manifesto/shared";
import DOMPurify from "dompurify";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Braces,
  Copy,
  EllipsisVertical,
  FileText,
  Link,
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
import { useEffect, useRef, useState } from "preact/hooks";
import { plugins } from "../autoNotes/registry.js";
import { noteColorMap, noteFontFamilies } from "../colors.js";
import { getColorPickerColors, t } from "../i18n/index.js";
import { buildShareUrl } from "../sharing.js";
import { refreshAutoNotes } from "../state/autoNotes.js";
import {
  archiveNote,
  createNote,
  restoreNote,
  togglePin,
  trashNote,
  unarchiveNote,
  updateNote,
} from "../state/index.js";
import { showSuccess } from "../state/ui.js";
import {
  downloadNoteAsJson,
  downloadNoteAsMarkdown,
} from "../utils/importExport.js";
import { renderMarkdown } from "../utils/remarkRenderer.js";
import { Dropdown } from "./Dropdown.js";
import { iconBtnClass } from "./NoteEditor.js";
import { CardPopover } from "./Popover.js";
import { ReminderChip } from "./ReminderChip.js";
import { ReminderPicker, ReminderPickerPanel } from "./ReminderPicker.js";
import { TagPicker } from "./TagPicker.js";
import { Tooltip } from "./Tooltip.js";

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "hr",
    "strong",
    "b",
    "em",
    "i",
    "del",
    "s",
    "blockquote",
    "pre",
    "code",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "u",
    "sub",
    "sup",
    "span",
    "input",
  ],
  ALLOWED_ATTR: [
    "href",
    "target",
    "rel",
    "src",
    "alt",
    "title",
    "class",
    "type",
    "checked",
    "disabled",
  ],
};

export function NoteReadonlyView({
  note,
  onClose,
}: {
  note: Note;
  onClose: () => void;
}) {
  const colors = noteColorMap[note.color];
  const pickerColors = getColorPickerColors();
  const pluginLabel =
    note.source?.kind === "auto-note"
      ? (plugins.value.find((p) => p.id === note.source?.pluginId)?.name ??
        note.source.pluginId)
      : null;

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showReminderChipPicker, setShowReminderChipPicker] = useState(false);
  const reminderChipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const html = DOMPurify.sanitize(
    renderMarkdown(note.content),
    PURIFY_CONFIG,
  ) as string;

  const closeAllMenus = () => {
    setShowColorPicker(false);
    setShowMenu(false);
    setShowTagPicker(false);
  };

  return (
    <article
      class={`${colors.bg} ${colors.border} relative z-10 sm:border sm:shadow-lg max-sm:h-full max-sm:flex max-sm:flex-col max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)]`}
    >
      {/* Top bar: back (mobile only) + pin. On desktop, pin floats absolute
          top-right; on mobile, this is a flex row above the title. */}
      <div class="max-sm:flex max-sm:items-center max-sm:justify-between max-sm:px-2.5 max-sm:pt-2">
        <div class="sm:hidden">
          <button
            type="button"
            class={iconBtnClass}
            onClick={onClose}
            aria-label={t("editor.back")}
          >
            <ArrowLeft class="w-5 h-5" />
          </button>
        </div>
        <div class="sm:absolute sm:top-2 sm:right-2 flex items-center gap-0.5">
          <Tooltip
            label={note.pinned ? t("noteCard.unpin") : t("noteCard.pin")}
          >
            <button
              type="button"
              class={iconBtnClass}
              onClick={() => togglePin(note.id)}
              aria-label={note.pinned ? t("noteCard.unpin") : t("noteCard.pin")}
            >
              {note.pinned ? (
                <PinOff class="w-4 h-4" />
              ) : (
                <Pin class="w-4 h-4" />
              )}
            </button>
          </Tooltip>
        </div>
      </div>

      <div class="p-4 max-sm:px-4 max-sm:pt-2 text-sm max-sm:flex-1 max-sm:overflow-y-auto max-sm:min-h-0 max-sm:flex max-sm:flex-col">
        {note.title && (
          <h2
            class="font-medium text-base mb-2 sm:pr-12"
            style={{ fontFamily: noteFontFamilies[note.font] || undefined }}
          >
            {note.title}
          </h2>
        )}
        <div
          class="prose prose-sm dark:prose-invert max-w-none text-neutral-700 dark:text-neutral-200"
          style={{ fontFamily: noteFontFamilies[note.font] || undefined }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {(note.tags.length > 0 || note.reminder) && (
          <div class="flex flex-wrap gap-1 mt-2 items-center">
            {note.tags.map((tag) => (
              <span
                key={tag}
                class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-neutral-200/60 dark:bg-neutral-700/60"
              >
                #{tag}
                <button
                  type="button"
                  class="hover:text-red-500 cursor-pointer"
                  onClick={() =>
                    updateNote(note.id, {
                      tags: note.tags.filter((x) => x !== tag),
                    })
                  }
                  aria-label={t("editor.removeTag", { tag })}
                >
                  ×
                </button>
              </span>
            ))}
            {note.reminder && (
              <span class="relative">
                <ReminderChip
                  reminder={note.reminder}
                  anchorRef={reminderChipRef}
                  onClick={() =>
                    setShowReminderChipPicker(!showReminderChipPicker)
                  }
                  onClear={() => updateNote(note.id, { reminder: null })}
                />
                {showReminderChipPicker && (
                  <CardPopover
                    anchorRef={reminderChipRef}
                    onClose={() => setShowReminderChipPicker(false)}
                  >
                    <div class="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 w-72">
                      <ReminderPickerPanel
                        reminder={note.reminder}
                        onChange={(reminder) =>
                          updateNote(note.id, { reminder })
                        }
                        onDone={() => setShowReminderChipPicker(false)}
                      />
                    </div>
                  </CardPopover>
                )}
              </span>
            )}
          </div>
        )}

        {pluginLabel && (
          <div class="mt-4 pt-2 border-t border-black/10 dark:border-white/10 text-xs text-black/40 dark:text-white/40 whitespace-pre-line">
            {t("autoNotes.generatedBy", { name: pluginLabel })}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div class="px-3 pt-1.5 pb-2 flex items-center gap-0.5">
        {note.source?.kind === "auto-note" && (
          <>
            <Tooltip
              label={t("autoNotes.generatedBy", { name: pluginLabel ?? "" })}
            >
              <span
                class="p-1.5 opacity-60"
                role="img"
                aria-label="Auto-generated"
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

        {/* Color picker */}
        <Dropdown
          open={showColorPicker}
          onClose={() => setShowColorPicker(false)}
          trigger={
            <Tooltip label={t("editor.color")}>
              <button
                type="button"
                class={iconBtnClass}
                onClick={() => {
                  setShowColorPicker(!showColorPicker);
                  setShowMenu(false);
                }}
                aria-label={t("editor.changeColor")}
              >
                <Palette class="w-4 h-4" />
              </button>
            </Tooltip>
          }
          placement="top-start"
          panelClass="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1"
        >
          {pickerColors.map((c) => (
            <Tooltip key={c.value} label={c.label}>
              <button
                type="button"
                class={`w-6 h-6 rounded-full cursor-pointer ${c.swatch} ${note.color === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
                onClick={() => {
                  updateNote(note.id, { color: c.value as NoteColor });
                  setShowColorPicker(false);
                }}
                aria-label={c.label}
              />
            </Tooltip>
          ))}
        </Dropdown>

        {/* Reminder */}
        <ReminderPicker
          reminder={note.reminder ?? null}
          onChange={(reminder) => updateNote(note.id, { reminder })}
          triggerClass={iconBtnClass}
        />

        {/* Kebab menu */}
        <Dropdown
          open={showMenu}
          onClose={() => {
            setShowMenu(false);
            setShowTagPicker(false);
          }}
          trigger={
            <Tooltip label={t("editor.more")}>
              <button
                type="button"
                class={iconBtnClass}
                onClick={() => {
                  setShowMenu(!showMenu);
                  setShowColorPicker(false);
                  setShowTagPicker(false);
                }}
                aria-label={t("editor.moreOptions")}
              >
                <EllipsisVertical class="w-4 h-4" />
              </button>
            </Tooltip>
          }
          placement="top-start"
          panelClass="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 min-w-48 w-max py-1"
        >
          {/* Tags */}
          <div class="relative">
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
              onClick={() => setShowTagPicker(!showTagPicker)}
            >
              <Tag class="w-4 h-4" />
              {t("editor.menu.tags")}
            </button>
            {showTagPicker && (
              <TagPicker
                tags={note.tags}
                onAddTag={(tag) => {
                  const trimmed = tag.trim().toLowerCase();
                  if (trimmed && !note.tags.includes(trimmed)) {
                    updateNote(note.id, { tags: [...note.tags, trimmed] });
                  }
                }}
              />
            )}
          </div>

          {/* Share link */}
          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
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
              closeAllMenus();
            }}
          >
            <Link class="w-4 h-4" />
            {t("editor.menu.shareLink")}
          </button>

          {/* Duplicate — strips auto-note markers so the copy is a plain note */}
          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
            onClick={() => {
              createNote({
                title: note.title,
                content: note.content,
                color: note.color,
                font: note.font,
                tags: [...note.tags],
              });
              closeAllMenus();
            }}
          >
            <Copy class="w-4 h-4" />
            {t("editor.menu.duplicate")}
          </button>

          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
            onClick={() => {
              downloadNoteAsMarkdown(note);
              closeAllMenus();
            }}
          >
            <FileText class="w-4 h-4" />
            {t("editor.menu.exportMarkdown")}
          </button>

          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
            onClick={() => {
              const { readonly: _r, source: _s, ...plain } = note;
              downloadNoteAsJson(plain as Note);
              closeAllMenus();
            }}
          >
            <Braces class="w-4 h-4" />
            {t("editor.menu.exportJson")}
          </button>

          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
            onClick={() => {
              if (note.archived) {
                unarchiveNote(note.id);
              } else {
                archiveNote(note.id);
              }
              closeAllMenus();
            }}
          >
            {note.archived ? (
              <ArchiveRestore class="w-4 h-4" />
            ) : (
              <Archive class="w-4 h-4" />
            )}
            {note.archived
              ? t("editor.menu.unarchive")
              : t("editor.menu.archive")}
          </button>

          <div class="my-1 border-t border-neutral-200 dark:border-neutral-700" />

          <button
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
            onClick={() => {
              if (note.trashed) {
                restoreNote(note.id);
              } else {
                trashNote(note.id);
              }
              closeAllMenus();
              onClose();
            }}
          >
            {note.trashed ? (
              <Undo2 class="w-4 h-4" />
            ) : (
              <Trash2 class="w-4 h-4" />
            )}
            {note.trashed ? t("editor.menu.undelete") : t("editor.menu.delete")}
          </button>
        </Dropdown>

        <div class="flex-1" />

        {/* Close */}
        <Tooltip label={t("noteCard.close")}>
          <button
            type="button"
            class={iconBtnClass}
            onClick={onClose}
            aria-label={t("noteCard.close")}
          >
            <X class="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
    </article>
  );
}
