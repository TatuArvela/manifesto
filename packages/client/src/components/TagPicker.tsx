import { normalizeTag } from "@manifesto/shared";
import { Square, SquareCheck, SquareMinus, Tag } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "#/i18n/index.ts";
import { allTags } from "#/state/views.ts";
import { tagCoverage } from "#/utils/tagCoverage.ts";
import { Dropdown, type DropdownPlacement } from "./Dropdown.tsx";
import { Tooltip } from "./Tooltip.tsx";

/** The panel on which a tag picker draws itself, wherever it opens. */
export const tagPickerPanelClass =
  "py-1 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 min-w-[180px] max-w-72";

/**
 * The field in which you type a tag. It calls back with the trimmed, lowercase
 * tag. This is the only place where a tag is normalized.
 */
function TagField({
  onAddTag,
  autoFocus,
}: {
  onAddTag: (tag: string) => void;
  autoFocus?: boolean | undefined;
}) {
  const [newTag, setNewTag] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const handleAdd = () => {
    const trimmed = normalizeTag(newTag);
    if (trimmed) {
      onAddTag(trimmed);
    }
    setNewTag("");
  };

  return (
    <input
      ref={inputRef}
      type="text"
      class="w-full px-2 py-1 max-sm:py-1.5 text-sm max-sm:text-base bg-neutral-100 dark:bg-neutral-700 rounded outline-none focus-visible:ring-2 focus-visible:ring-blue-500 mb-1"
      placeholder={t("tagPicker.placeholder")}
      value={newTag}
      onInput={(e) => setNewTag((e.target as HTMLInputElement).value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") handleAdd();
        if (e.key === "Escape") setNewTag("");
      }}
    />
  );
}

const tagRowClass =
  "w-full text-left px-2 py-1 text-sm rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer";

/**
 * An inline tag picker with a text input and a list of existing tags. The card
 * and the note editor use it.
 */
export function TagPicker({
  tags,
  onAddTag,
  autoFocus,
}: {
  /**
   * The tags that are applied now (to remove them from the suggestion list).
   */
  tags: string[];
  /** Called with the trimmed, lowercase tag string. */
  onAddTag: (tag: string) => void;
  /** Puts the caret in the field when the picker opens. */
  autoFocus?: boolean;
}) {
  return (
    <div class="px-3 py-2">
      <TagField onAddTag={onAddTag} autoFocus={autoFocus} />
      {allTags.value
        .filter((existing) => !tags.includes(existing))
        .map((tag) => (
          <button
            key={tag}
            type="button"
            class={`block ${tagRowClass}`}
            onClick={() => onAddTag(tag)}
          >
            #{tag}
          </button>
        ))}
    </div>
  );
}

const coverageIcon = { all: SquareCheck, some: SquareMinus, none: Square };

/**
 * The tag picker of a selection. Each tag is listed with a box that tells if
 * all, some or none of the selected notes have it. A click on a tag that they
 * all have removes it from them. A click on any other tag gives it to the notes
 * that do not have it yet.
 */
export function SelectionTagPicker({
  selected,
  onSetTag,
}: {
  selected: { tags: string[] }[];
  /** Called with a normalized tag, and if the selection must have it. */
  onSetTag: (tag: string, on: boolean) => void;
}) {
  return (
    <div class="px-3 py-2">
      <TagField onAddTag={(tag) => onSetTag(tag, true)} autoFocus />
      {tagCoverage(allTags.value, selected).map(({ tag, coverage }) => {
        const Icon = coverageIcon[coverage];
        return (
          // biome-ignore lint/a11y/useSemanticElements: a native checkbox has no "mixed" state without script
          <button
            key={tag}
            type="button"
            role="checkbox"
            aria-checked={
              coverage === "all"
                ? "true"
                : coverage === "some"
                  ? "mixed"
                  : "false"
            }
            class={`flex items-center gap-2 ${tagRowClass}`}
            onClick={() => onSetTag(tag, coverage !== "all")}
          >
            <Icon class="w-4 h-4 shrink-0" aria-hidden="true" />
            <span class="truncate">#{tag}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The tag button of a note: the tag icon, which opens the picker below it. It
 * stays open after you add a tag, because a note frequently gets many tags at
 * one time. The tag that you just added goes out of the suggestions.
 */
export function TagPickerButton({
  tags,
  onAddTag,
  triggerClass,
  iconClass = "w-4 h-4",
  placement = "bottom-start",
}: {
  tags: string[];
  /** Called with a normalized tag that the note does not have yet. */
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
            // TagPicker trims and changes to lowercase before it calls back.
            // Thus, here the code only has to prevent a tag from being added
            // two times.
            if (!tags.includes(tag)) onAddTag(tag);
          }}
        />
      )}
    </Dropdown>
  );
}
