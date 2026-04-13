import type { NoteColor } from "@manifesto/shared";
import {
  Archive,
  ArchiveRestore,
  Check,
  Code,
  Copy,
  Eye,
  Palette,
  Pin,
  PinOff,
  Tag,
  Trash2,
  X,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { colorPickerColors, noteColorMap } from "../colors.js";
import { allTags } from "../state/index.js";
import { SegmentedContentEditor } from "./SegmentedContentEditor.js";
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
  pinned: boolean;
  onPinToggle: () => void;
  tags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onDone: () => void;
  disabled?: boolean;
  contentLocked?: boolean;
  metadata?: ComponentChildren;
  onDuplicate?: () => void;
  onArchive?: () => void;
  archived?: boolean;
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
  pinned,
  onPinToggle,
  tags,
  onAddTag,
  onRemoveTag,
  onDone,
  disabled,
  contentLocked,
  metadata,
  onDuplicate,
  onArchive,
  archived,
  onDelete,
  deleteLabel,
}: NoteEditorProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [rawMode, setRawMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const colors = noteColorMap[color];

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed) {
      onAddTag(trimmed);
    }
    setNewTag("");
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
          type="text"
          class="w-full bg-transparent outline-none font-medium text-base mb-2 placeholder:text-gray-400 pr-32"
          placeholder="Title"
          value={title}
          onInput={(e) => onTitleChange((e.target as HTMLInputElement).value)}
          disabled={disabled}
        />

        <SegmentedContentEditor
          content={content}
          onChange={onContentChange}
          disabled={disabled}
          contentLocked={contentLocked}
          rawMode={rawMode}
          autoFocus
        />

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
      <div class="px-3 pt-1.5 pb-2 flex items-center gap-0.5 flex-wrap">
        {/* Color picker */}
        <div class="relative flex">
          <Tooltip label="Color">
            <button
              type="button"
              class={iconBtnClass}
              onClick={() => {
                setShowColorPicker(!showColorPicker);
                setShowTagPicker(false);
              }}
              aria-label="Change color"
            >
              <Palette class="w-4 h-4" />
            </button>
          </Tooltip>
          {showColorPicker && (
            <>
              <div
                class="fixed inset-0 z-10"
                onClick={() => setShowColorPicker(false)}
              />
              <div class="absolute bottom-full left-0 mb-2 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 flex gap-1 z-20">
                {colorPickerColors.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    class={`w-6 h-6 rounded-full ${c.swatch} ${color === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
                    onClick={() => onColorChange(c.value)}
                    aria-label={c.label}
                    title={c.label}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Tag picker */}
        <div class="relative flex">
          <Tooltip label="Tags">
            <button
              type="button"
              class={iconBtnClass}
              onClick={() => {
                setShowTagPicker(!showTagPicker);
                setShowColorPicker(false);
              }}
              aria-label="Tags"
            >
              <Tag class="w-4 h-4" />
            </button>
          </Tooltip>
          {showTagPicker && (
            <>
              <div
                class="fixed inset-0 z-10"
                onClick={() => setShowTagPicker(false)}
              />
              <div class="absolute bottom-full left-0 mb-2 p-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-48 z-20">
                <input
                  type="text"
                  class="w-full px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded outline-none mb-2"
                  placeholder="Add tag..."
                  value={newTag}
                  onInput={(e) =>
                    setNewTag((e.target as HTMLInputElement).value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddTag(newTag);
                  }}
                />
                {allTags.value
                  .filter((t) => !tags.includes(t))
                  .map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      class="block w-full text-left px-2 py-1 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                      onClick={() => handleAddTag(tag)}
                    >
                      #{tag}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>

        {/* Duplicate */}
        {onDuplicate && (
          <Tooltip label="Duplicate">
            <button
              type="button"
              class={iconBtnClass}
              onClick={onDuplicate}
              aria-label="Duplicate note"
            >
              <Copy class="w-4 h-4" />
            </button>
          </Tooltip>
        )}

        {/* Archive */}
        {onArchive && (
          <Tooltip label={archived ? "Unarchive" : "Archive"}>
            <button
              type="button"
              class={iconBtnClass}
              onClick={onArchive}
              aria-label={archived ? "Unarchive" : "Archive"}
            >
              {archived ? (
                <ArchiveRestore class="w-4 h-4" />
              ) : (
                <Archive class="w-4 h-4" />
              )}
            </button>
          </Tooltip>
        )}

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

        {/* Delete */}
        {onDelete && (
          <>
            <div class="flex-1" />
            <Tooltip label={deleteLabel ?? "Delete"}>
              <button
                type="button"
                class="p-1.5 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30"
                onClick={onDelete}
                aria-label={deleteLabel ?? "Delete"}
              >
                {deleteLabel ? (
                  <X class="w-4 h-4" />
                ) : (
                  <Trash2 class="w-4 h-4" />
                )}
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </article>
  );
}
