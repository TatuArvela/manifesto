import { type NoteColor, NoteFont } from "@manifesto/shared";
import {
  Archive,
  ArchiveRestore,
  Check,
  Code,
  Copy,
  EllipsisVertical,
  Eye,
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
import {
  colorPickerColors,
  noteColorMap,
  noteFontFamilies,
} from "../colors.js";
import { Dropdown } from "./Dropdown.js";
import {
  SegmentedContentEditor,
  type SegmentedContentEditorHandle,
} from "./SegmentedContentEditor.js";
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
  pinned: boolean;
  onPinToggle: () => void;
  tags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onDone: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  disabled?: boolean;
  contentLocked?: boolean;
  metadata?: ComponentChildren;
  onDuplicate?: () => void;
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
  pinned,
  onPinToggle,
  tags,
  onAddTag,
  onRemoveTag,
  onDone,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  disabled,
  contentLocked,
  metadata,
  onDuplicate,
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
  const [rawMode, setRawMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<SegmentedContentEditorHandle>(null);

  // Ctrl/Cmd+Z for undo, Ctrl/Cmd+Shift+Z for redo
  useEffect(() => {
    if (!onUndo && !onRedo) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        onUndo?.();
      } else if (mod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        onRedo?.();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onUndo, onRedo]);

  const colors = noteColorMap[color];

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

  return (
    <article
      ref={containerRef}
      class={`${colors.bg} ${colors.border} border shadow-lg relative z-10`}
    >
      {/* Top-right: pin */}
      <div class="absolute top-2 right-2 flex items-center gap-0.5">
        <Tooltip label={pinned ? "Unpin" : "Pin"}>
          <button
            type="button"
            class={`${iconBtnClass} transition-opacity`}
            onClick={onPinToggle}
            aria-label={pinned ? "Unpin" : "Pin"}
            disabled={disabled}
          >
            {pinned ? <PinOff class="w-4 h-4" /> : <Pin class="w-4 h-4" />}
          </button>
        </Tooltip>
      </div>

      {/* Content area */}
      <div class="p-4">
        <input
          ref={titleRef}
          type="text"
          class="w-full bg-transparent outline-none font-medium text-base mb-2 placeholder:text-gray-400 pr-32"
          placeholder="Title"
          value={title}
          onInput={(e) => onTitleChange((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              contentRef.current?.focusFirst();
            }
          }}
          disabled={disabled}
          style={{ fontFamily: noteFontFamilies[font] || undefined }}
        />

        <div style={{ fontFamily: noteFontFamilies[font] || undefined }}>
          <SegmentedContentEditor
            content={content}
            onChange={onContentChange}
            disabled={disabled}
            contentLocked={contentLocked}
            rawMode={rawMode}
            autoFocus
            editorRef={contentRef}
            onNavigateUp={() => titleRef.current?.focus()}
          />
        </div>

        {metadata}

        {tags.length > 0 && (
          <div class="flex flex-wrap gap-1 mt-2">
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
                  aria-label={`Remove tag ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
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
            <Tooltip label="Color">
              <button
                type="button"
                class={iconBtnClass}
                onClick={() => {
                  setShowColorPicker(!showColorPicker);
                  setShowMenu(false);
                  setShowFontPicker(false);
                }}
                aria-label="Change color"
              >
                <Palette class="w-4 h-4" />
              </button>
            </Tooltip>
          }
          panelClass="absolute bottom-full left-0 mb-2 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 flex gap-1 z-20"
        >
          {colorPickerColors.map((c) => (
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
            <Tooltip label="Font">
              <button
                type="button"
                class={iconBtnClass}
                onClick={() => {
                  setShowFontPicker(!showFontPicker);
                  setShowColorPicker(false);
                  setShowMenu(false);
                }}
                aria-label="Change font"
              >
                <PenLine class="w-4 h-4" />
              </button>
            </Tooltip>
          }
          panelClass="absolute bottom-full left-0 mb-2 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 flex gap-1 z-20"
        >
          {Object.values(NoteFont).map((f) => (
            <Tooltip
              key={f}
              label={
                f === NoteFont.Default
                  ? "Default"
                  : f === NoteFont.PermanentMarker
                    ? "Permanent Marker"
                    : "Comic Relief"
              }
            >
              <button
                type="button"
                class={`px-2 py-1 text-sm rounded cursor-pointer ${font === f ? "ring-2 ring-blue-500 ring-offset-1" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                style={{
                  fontFamily: noteFontFamilies[f] || undefined,
                }}
                onClick={() => onFontChange(f)}
                aria-label={f}
              >
                Aa
              </button>
            </Tooltip>
          ))}
        </Dropdown>

        {/* Kebab menu */}
        <Dropdown
          open={showMenu}
          onClose={() => {
            setShowMenu(false);
            setShowTagPicker(false);
          }}
          trigger={
            <Tooltip label="More">
              <button
                type="button"
                class={iconBtnClass}
                onClick={() => {
                  setShowMenu(!showMenu);
                  setShowColorPicker(false);
                  setShowFontPicker(false);
                  setShowTagPicker(false);
                }}
                aria-label="More options"
              >
                <EllipsisVertical class="w-4 h-4" />
              </button>
            </Tooltip>
          }
          panelClass="absolute bottom-full left-0 mb-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-48 z-20 py-1"
        >
          {/* Tags */}
          <div class="relative">
            <button
              type="button"
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
              onClick={() => setShowTagPicker(!showTagPicker)}
            >
              <Tag class="w-4 h-4" />
              Tags
            </button>
            {showTagPicker && <TagPicker tags={tags} onAddTag={handleAddTag} />}
          </div>

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
              Duplicate
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
              {archived ? "Unarchive" : "Archive"}
            </button>
          )}

          {/* Delete / Undelete (edit mode only — not shown when deleteLabel is set) */}
          {onDelete && !deleteLabel && (
            <>
              <div class="my-1 border-t border-gray-200 dark:border-gray-700" />
              <button
                type="button"
                class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                onClick={() => {
                  onDelete();
                  closeAllMenus();
                }}
              >
                {trashed ? (
                  <Undo2 class="w-4 h-4" />
                ) : (
                  <Trash2 class="w-4 h-4" />
                )}
                {trashed ? "Undelete" : "Delete"}
              </button>
            </>
          )}
        </Dropdown>

        {/* Normal / Raw mode toggle */}
        <Tooltip label={rawMode ? "Normal mode" : "Raw mode"}>
          <button
            type="button"
            class={iconBtnClass}
            onClick={() => setRawMode(!rawMode)}
            aria-label={rawMode ? "Normal mode" : "Raw mode"}
          >
            {rawMode ? <Eye class="w-4 h-4" /> : <Code class="w-4 h-4" />}
          </button>
        </Tooltip>

        {/* Undo / Redo */}
        {onUndo && (
          <Tooltip label="Undo">
            <button
              type="button"
              class={`${iconBtnClass} ${canUndo ? "" : "opacity-30 cursor-default"}`}
              onClick={onUndo}
              aria-label="Undo"
              disabled={!canUndo}
            >
              <Undo class="w-4 h-4" />
            </button>
          </Tooltip>
        )}
        {onRedo && (
          <Tooltip label="Redo">
            <button
              type="button"
              class={`${iconBtnClass} ${canRedo ? "" : "opacity-30 cursor-default"}`}
              onClick={onRedo}
              aria-label="Redo"
              disabled={!canRedo}
            >
              <Redo class="w-4 h-4" />
            </button>
          </Tooltip>
        )}

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
        <Tooltip label="Done">
          <button
            type="button"
            class={iconBtnClass}
            onClick={onDone}
            aria-label="Done"
          >
            <Check class="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
    </article>
  );
}
