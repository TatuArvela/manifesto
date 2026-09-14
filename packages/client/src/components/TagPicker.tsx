import { Tag } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import { allTags } from "../state/index.js";
import { Dropdown, type DropdownPlacement } from "./Dropdown.js";
import { Tooltip } from "./Tooltip.js";

/** The panel a tag picker draws itself on, wherever it opens. */
export const tagPickerPanelClass =
  "py-1 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 min-w-[180px] max-w-72";

/**
 * Inline tag picker with a text input and list of existing tags.
 * Used in the selection toolbar, on the card, and in the note editor.
 */
export function TagPicker({
  tags,
  onAddTag,
  autoFocus,
}: {
  /** Currently applied tags (to filter them out of the suggestion list) */
  tags: string[];
  /** Called with the trimmed, lowercased tag string */
  onAddTag: (tag: string) => void;
  /** Puts the caret in the field as the picker opens. */
  autoFocus?: boolean;
}) {
  const [newTag, setNewTag] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const handleAdd = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed) {
      onAddTag(trimmed);
    }
    setNewTag("");
  };

  return (
    <div class="px-3 py-2">
      <input
        ref={inputRef}
        type="text"
        class="w-full px-2 py-1 max-sm:py-1.5 text-sm max-sm:text-base bg-neutral-100 dark:bg-neutral-700 rounded outline-none mb-1"
        placeholder={t("tagPicker.placeholder")}
        value={newTag}
        onInput={(e) => setNewTag((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") handleAdd(newTag);
          if (e.key === "Escape") setNewTag("");
        }}
      />
      {allTags.value
        .filter((existing) => !tags.includes(existing))
        .map((tag) => (
          <button
            key={tag}
            type="button"
            class="block w-full text-left px-2 py-1 text-sm rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
            onClick={() => handleAdd(tag)}
          >
            #{tag}
          </button>
        ))}
    </div>
  );
}

/**
 * A note's tag button: the tag icon, opening the picker above it. It stays
 * open after a tag is added, since a note often takes several at once, and the
 * one just added drops out of the suggestions.
 */
export function TagPickerButton({
  tags,
  onAddTag,
  triggerClass,
  iconClass = "w-4 h-4",
  placement = "top-start",
}: {
  tags: string[];
  /** Called with a normalized tag the note does not have yet. */
  onAddTag: (tag: string) => void;
  triggerClass: string;
  iconClass?: string;
  placement?: DropdownPlacement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      placement={placement}
      panelClass={tagPickerPanelClass}
      trigger={
        <Tooltip label={t("noteMenu.tags")}>
          <button
            type="button"
            class={triggerClass}
            onClick={() => setOpen(!open)}
            aria-label={t("noteMenu.tags")}
          >
            <Tag class={iconClass} />
          </button>
        </Tooltip>
      }
    >
      {/* Mounted only while open, so the field is empty and focused each time. */}
      {open && (
        <TagPicker
          tags={tags}
          autoFocus
          onAddTag={(tag) => {
            // TagPicker trims and lowercases before it calls back, so all that
            // is left here is not adding a tag twice.
            if (!tags.includes(tag)) onAddTag(tag);
          }}
        />
      )}
    </Dropdown>
  );
}
