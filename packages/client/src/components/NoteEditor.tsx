import type { LinkPreview, NoteReminder } from "@manifesto/shared";
import { type NoteColor, NoteFont } from "@manifesto/shared";
import { type Editor, editorStateCtx, editorViewCtx } from "@milkdown/kit/core";
import { redoCommand, undoCommand } from "@milkdown/kit/plugin/history";
import { redoDepth, undoDepth } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { callCommand } from "@milkdown/kit/utils";
import {
  Archive,
  ArchiveRestore,
  Braces,
  Check,
  Code,
  Copy,
  EllipsisVertical,
  Eye,
  FileText,
  History,
  Image as ImageIcon,
  Link,
  ListX,
  Palette,
  PenLine,
  Pin,
  PinOff,
  Redo,
  Tag,
  Trash2,
  Undo,
  Undo2,
  X,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "../colors.js";
import { getDeletionRange } from "../extensions/taskItemDraggable.js";
import { getColorPickerColors, getFontLabel, t } from "../i18n/index.js";
import { extractUrls } from "../utils/linkPreview.js";
import { Dropdown } from "./Dropdown.js";
import { FormattingToolbar } from "./FormattingToolbar.js";
import { ImageGallery } from "./ImageGallery.js";
import { LinkPreviewList } from "./LinkPreviewList.js";
import { MilkdownEditor } from "./MilkdownEditor.js";
import { CardPopover } from "./Popover.js";
import { ReminderChip } from "./ReminderChip.js";
import { ReminderPicker, ReminderPickerPanel } from "./ReminderPicker.js";
import { TagPicker } from "./TagPicker.js";
import { Tooltip } from "./Tooltip.js";

const iconBtnClass =
  "p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer";

export { iconBtnClass };

interface NoteEditorProps {
  title: string;
  onTitleChange: (value: string) => void;
  content: string;
  onContentChange: (value: string) => void;
  color: NoteColor;
  onColorChange: (color: NoteColor) => void;
  font: NoteFont;
  onFontChange: (font: NoteFont) => void;
  images: string[];
  onAddImages: (dataUrls: string[]) => void;
  onRemoveImage: (index: number) => void;
  linkPreviews: LinkPreview[];
  onAddLinkPreview: (url: string) => void;
  onRemoveLinkPreview: (index: number) => void;
  pinned: boolean;
  onPinToggle: () => void;
  tags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  reminder?: NoteReminder | null;
  onReminderChange?: (reminder: NoteReminder | null) => void;
  onDone: () => void;
  disabled?: boolean;
  contentLocked?: boolean;
  metadata?: ComponentChildren;
  onShowVersions?: () => void;
  onShare?: () => void;
  onDuplicate?: () => void;
  onExportMarkdown?: () => void;
  onExportJson?: () => void;
  onArchive?: () => void;
  archived?: boolean;
  trashed?: boolean;
  onDelete?: () => void;
  deleteLabel?: string;
}

export function NoteEditor({
  title,
  onTitleChange,
  content,
  onContentChange,
  color,
  onColorChange,
  font,
  onFontChange,
  images,
  onAddImages,
  onRemoveImage,
  linkPreviews,
  onAddLinkPreview,
  onRemoveLinkPreview,
  pinned,
  onPinToggle,
  tags,
  onAddTag,
  onRemoveTag,
  reminder,
  onReminderChange,
  onDone,
  disabled,
  contentLocked,
  metadata,
  onShowVersions,
  onShare,
  onDuplicate,
  onExportMarkdown,
  onExportJson,
  onArchive,
  archived,
  trashed,
  onDelete,
  deleteLabel,
}: NoteEditorProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showReminderChipPicker, setShowReminderChipPicker] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  // Counter bumped on every editor transaction — drives undo/redo button
  // state and toolbar active-format refresh.
  const [txCount, setTxCount] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reminderChipRef = useRef<HTMLButtonElement>(null);

  const readFilesAsDataUrls = async (files: File[]): Promise<string[]> => {
    const results = await Promise.all(
      files.map(
        (file) =>
          new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          }),
      ),
    );
    return results.filter((r): r is string => r !== null);
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imageFiles = [...files].filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const urls = await readFilesAsDataUrls(imageFiles);
    if (urls.length > 0) onAddImages(urls);
  };

  useEffect(() => {
    if (disabled) return;
    const handlePaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const imageItems = [...e.clipboardData.items].filter((it) =>
        it.type.startsWith("image/"),
      );
      if (imageItems.length > 0) {
        const files = imageItems
          .map((it) => it.getAsFile())
          .filter((f): f is File => f !== null);
        if (files.length > 0) {
          e.preventDefault();
          const urls = await readFilesAsDataUrls(files);
          if (urls.length > 0) onAddImages(urls);
          return;
        }
      }
      const text = e.clipboardData.getData("text");
      if (text) {
        for (const url of extractUrls(text)) onAddLinkPreview(url);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [disabled, onAddImages, onAddLinkPreview]);

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const prev =
        view.props.dispatchTransaction?.bind(view) ??
        ((tr: Parameters<typeof view.state.apply>[0]) =>
          view.updateState(view.state.apply(tr)));
      view.setProps({
        dispatchTransaction(tr) {
          prev(tr);
          if (!cancelled) setTxCount((c) => c + 1);
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [editor]);

  const colors = noteColorMap[color];
  const pickerColors = getColorPickerColors();

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed) {
      onAddTag(trimmed);
    }
  };

  const closeAllMenus = () => {
    setShowColorPicker(false);
    setShowFontPicker(false);
    setShowMenu(false);
    setShowTagPicker(false);
  };

  const canUndo = editor
    ? editor.action((ctx) => undoDepth(ctx.get(editorStateCtx)) > 0)
    : false;
  const canRedo = editor
    ? editor.action((ctx) => redoDepth(ctx.get(editorStateCtx)) > 0)
    : false;
  const hasCheckedItems = editor
    ? editor.action((ctx) => {
        const state = ctx.get(editorStateCtx);
        let found = false;
        state.doc.descendants((node) => {
          if (found) return false;
          if (node.type.name === "list_item" && node.attrs.checked === true) {
            found = true;
            return false;
          }
        });
        return found;
      })
    : false;
  // Reference txCount so the memo recomputes on each transaction.
  void txCount;

  const deleteCheckedItems = () => {
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      // Delete one checked item at a time so getDeletionRange re-evaluates
      // ancestor lists after each removal (emptied single-child lists get
      // pruned on the next pass).
      while (true) {
        const { doc } = view.state;
        let targetPos = -1;
        let targetSize = 0;
        doc.descendants((node, pos) => {
          if (targetPos >= 0) return false;
          if (node.type.name === "list_item" && node.attrs.checked === true) {
            targetPos = pos;
            targetSize = node.nodeSize;
            return false;
          }
        });
        if (targetPos < 0) break;
        const range = getDeletionRange(doc, targetPos, targetSize);
        view.dispatch(view.state.tr.delete(range.from, range.to));
      }
      view.focus();
    });
  };

  return (
    <article
      class={`${colors.bg} ${colors.border} border shadow-lg relative z-10`}
    >
      {/* Top-right: pin */}
      <div class="absolute top-2 right-2 flex items-center gap-0.5">
        <Tooltip label={pinned ? t("noteCard.unpin") : t("noteCard.pin")}>
          <button
            type="button"
            class={`${iconBtnClass} transition-opacity`}
            onClick={onPinToggle}
            aria-label={pinned ? t("noteCard.unpin") : t("noteCard.pin")}
            disabled={disabled}
          >
            {pinned ? <PinOff class="w-4 h-4" /> : <Pin class="w-4 h-4" />}
          </button>
        </Tooltip>
      </div>

      {images.length > 0 && (
        <ImageGallery images={images} onDelete={onRemoveImage} />
      )}

      {/* Content area */}
      <div class="p-4">
        <input
          ref={titleRef}
          type="text"
          class="w-full bg-transparent outline-none font-medium text-base mb-2 placeholder:text-gray-400 pr-32"
          placeholder={t("editor.titlePlaceholder")}
          value={title}
          onInput={(e) => onTitleChange((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              editor?.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                view.focus();
                view.dispatch(
                  view.state.tr.setSelection(
                    TextSelection.atStart(view.state.doc),
                  ),
                );
              });
            }
          }}
          disabled={disabled}
          style={{ fontFamily: noteFontFamilies[font] || undefined }}
        />

        {!disabled && !contentLocked && editor && (
          <FormattingToolbar
            editor={editor}
            tick={txCount}
            disabled={disabled}
            onAddLink={onAddLinkPreview}
          />
        )}

        <div style={{ fontFamily: noteFontFamilies[font] || undefined }}>
          <MilkdownEditor
            content={content}
            onChange={onContentChange}
            disabled={disabled}
            contentLocked={contentLocked}
            rawMode={rawMode}
            autoFocus
            onEditorReady={setEditor}
          />
        </div>

        {metadata}

        {linkPreviews.length > 0 && (
          <div class="mt-3">
            <LinkPreviewList
              previews={linkPreviews}
              variant="editor"
              onRemove={onRemoveLinkPreview}
            />
          </div>
        )}

        {(tags.length > 0 || reminder) && (
          <div class="flex flex-wrap gap-1 mt-2 items-center">
            {tags.map((tag) => (
              <span
                key={tag}
                class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-200/60 dark:bg-gray-700/60"
              >
                #{tag}
                <button
                  type="button"
                  class="hover:text-red-500 cursor-pointer"
                  onClick={() => onRemoveTag(tag)}
                  aria-label={t("editor.removeTag", { tag })}
                >
                  ×
                </button>
              </span>
            ))}
            {reminder && (
              <span class="relative">
                <ReminderChip
                  reminder={reminder}
                  anchorRef={reminderChipRef}
                  onClick={() =>
                    setShowReminderChipPicker(!showReminderChipPicker)
                  }
                  onClear={
                    onReminderChange ? () => onReminderChange(null) : undefined
                  }
                />
                {showReminderChipPicker && onReminderChange && (
                  <CardPopover
                    anchorRef={reminderChipRef}
                    onClose={() => setShowReminderChipPicker(false)}
                  >
                    <div class="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-72">
                      <ReminderPickerPanel
                        reminder={reminder}
                        onChange={onReminderChange}
                        onDone={() => setShowReminderChipPicker(false)}
                      />
                    </div>
                  </CardPopover>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div class="px-3 pt-1.5 pb-2 flex items-center gap-0.5">
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
                  setShowFontPicker(false);
                }}
                aria-label={t("editor.changeColor")}
              >
                <Palette class="w-4 h-4" />
              </button>
            </Tooltip>
          }
          placement="top-start"
          panelClass="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 flex gap-1"
        >
          {pickerColors.map((c) => (
            <Tooltip key={c.value} label={c.label}>
              <button
                type="button"
                class={`w-6 h-6 rounded-full cursor-pointer ${c.swatch} ${color === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
                onClick={() => onColorChange(c.value)}
                aria-label={c.label}
              />
            </Tooltip>
          ))}
        </Dropdown>

        {/* Font picker */}
        <Dropdown
          open={showFontPicker}
          onClose={() => setShowFontPicker(false)}
          trigger={
            <Tooltip label={t("editor.font")}>
              <button
                type="button"
                class={iconBtnClass}
                onClick={() => {
                  setShowFontPicker(!showFontPicker);
                  setShowColorPicker(false);
                  setShowMenu(false);
                }}
                aria-label={t("editor.changeFont")}
              >
                <PenLine class="w-4 h-4" />
              </button>
            </Tooltip>
          }
          placement="top-start"
          panelClass="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 flex gap-1"
        >
          {Object.values(NoteFont).map((f) => {
            const label = getFontLabel(f);
            return (
              <Tooltip key={f} label={label}>
                <button
                  type="button"
                  class={`px-2 py-1 text-sm rounded cursor-pointer ${font === f ? "ring-2 ring-blue-500 ring-offset-1" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                  style={{
                    fontFamily: noteFontFamilies[f] || undefined,
                  }}
                  onClick={() => onFontChange(f)}
                  aria-label={label}
                >
                  Aa
                </button>
              </Tooltip>
            );
          })}
        </Dropdown>

        {/* Reminder */}
        {onReminderChange && (
          <ReminderPicker
            reminder={reminder ?? null}
            onChange={onReminderChange}
            triggerClass={iconBtnClass}
          />
        )}

        {/* Add image */}
        <Tooltip label={t("editor.addImage")}>
          <button
            type="button"
            class={iconBtnClass}
            onClick={() => fileInputRef.current?.click()}
            aria-label={t("editor.addImage")}
            disabled={disabled}
          >
            <ImageIcon class="w-4 h-4" />
          </button>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            handleFilesSelected(input.files);
            input.value = "";
          }}
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
                  setShowFontPicker(false);
                  setShowTagPicker(false);
                }}
                aria-label={t("editor.moreOptions")}
              >
                <EllipsisVertical class="w-4 h-4" />
              </button>
            </Tooltip>
          }
          placement="top-start"
          panelClass="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 min-w-48 w-max py-1"
        >
          {/* Tags */}
          <div class="relative">
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              onClick={() => setShowTagPicker(!showTagPicker)}
            >
              <Tag class="w-4 h-4" />
              {t("editor.menu.tags")}
            </button>
            {showTagPicker && <TagPicker tags={tags} onAddTag={handleAddTag} />}
          </div>

          {/* Version history */}
          {onShowVersions && (
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              onClick={() => {
                onShowVersions();
                closeAllMenus();
              }}
            >
              <History class="w-4 h-4" />
              {t("editor.menu.versionHistory")}
            </button>
          )}

          {/* Share link */}
          {onShare && (
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              onClick={() => {
                onShare();
                closeAllMenus();
              }}
            >
              <Link class="w-4 h-4" />
              {t("editor.menu.shareLink")}
            </button>
          )}

          {/* Duplicate */}
          {onDuplicate && (
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              onClick={() => {
                onDuplicate();
                closeAllMenus();
              }}
            >
              <Copy class="w-4 h-4" />
              {t("editor.menu.duplicate")}
            </button>
          )}

          {/* Export as Markdown */}
          {onExportMarkdown && (
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              onClick={() => {
                onExportMarkdown();
                closeAllMenus();
              }}
            >
              <FileText class="w-4 h-4" />
              {t("editor.menu.exportMarkdown")}
            </button>
          )}

          {/* Export as JSON */}
          {onExportJson && (
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              onClick={() => {
                onExportJson();
                closeAllMenus();
              }}
            >
              <Braces class="w-4 h-4" />
              {t("editor.menu.exportJson")}
            </button>
          )}

          {/* Archive */}
          {onArchive && (
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              onClick={() => {
                onArchive();
                closeAllMenus();
              }}
            >
              {archived ? (
                <ArchiveRestore class="w-4 h-4" />
              ) : (
                <Archive class="w-4 h-4" />
              )}
              {archived ? t("editor.menu.unarchive") : t("editor.menu.archive")}
            </button>
          )}

          {/* Destructive actions — checked items / delete */}
          {((hasCheckedItems && !disabled && !contentLocked) ||
            (onDelete && !deleteLabel)) && (
            <div class="my-1 border-t border-gray-200 dark:border-gray-700" />
          )}

          {/* Delete checked items */}
          {hasCheckedItems && !disabled && !contentLocked && (
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              onClick={() => {
                deleteCheckedItems();
                closeAllMenus();
              }}
            >
              <ListX class="w-4 h-4" />
              {t("editor.menu.deleteChecked")}
            </button>
          )}

          {/* Delete / Undelete (edit mode only — not shown when deleteLabel is set) */}
          {onDelete && !deleteLabel && (
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              onClick={() => {
                onDelete();
                closeAllMenus();
              }}
            >
              {trashed ? <Undo2 class="w-4 h-4" /> : <Trash2 class="w-4 h-4" />}
              {trashed ? t("editor.menu.undelete") : t("editor.menu.delete")}
            </button>
          )}
        </Dropdown>

        {/* Normal / Raw mode toggle */}
        <Tooltip label={rawMode ? t("editor.normalMode") : t("editor.rawMode")}>
          <button
            type="button"
            class={iconBtnClass}
            onClick={() => setRawMode(!rawMode)}
            aria-label={rawMode ? t("editor.normalMode") : t("editor.rawMode")}
          >
            {rawMode ? <Eye class="w-4 h-4" /> : <Code class="w-4 h-4" />}
          </button>
        </Tooltip>

        {/* Undo / Redo */}
        <Tooltip label={t("editor.undo")}>
          <button
            type="button"
            class={`${iconBtnClass} ${canUndo ? "" : "opacity-30 cursor-default"}`}
            onClick={() => editor?.action(callCommand(undoCommand.key))}
            aria-label={t("editor.undo")}
            disabled={!canUndo}
          >
            <Undo class="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip label={t("editor.redo")}>
          <button
            type="button"
            class={`${iconBtnClass} ${canRedo ? "" : "opacity-30 cursor-default"}`}
            onClick={() => editor?.action(callCommand(redoCommand.key))}
            aria-label={t("editor.redo")}
            disabled={!canRedo}
          >
            <Redo class="w-4 h-4" />
          </button>
        </Tooltip>

        <div class="flex-1" />

        {/* Discard (new note mode) */}
        {onDelete && deleteLabel && (
          <Tooltip label={deleteLabel}>
            <button
              type="button"
              class={iconBtnClass}
              onClick={onDelete}
              aria-label={deleteLabel}
            >
              <X class="w-4 h-4" />
            </button>
          </Tooltip>
        )}

        {/* Done */}
        <Tooltip label={t("editor.done")}>
          <button
            type="button"
            class={iconBtnClass}
            onClick={onDone}
            aria-label={t("editor.done")}
          >
            <Check class="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
    </article>
  );
}
