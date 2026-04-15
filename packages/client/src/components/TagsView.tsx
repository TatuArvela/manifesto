import { Archive, Plus, Trash2 } from "lucide-preact";
import { useRef, useState } from "preact/hooks";
import {
  activeTag,
  addTagToNotes,
  allTags,
  deleteTag,
  tagsSelectedNotes,
  tagsSelectMode,
  tagsShowArchived,
  tagsShowTrashed,
} from "../state/index.js";
import { Tooltip } from "./Tooltip.js";

function MiniToggle({
  checked,
  onChange,
  label,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  children: preact.ComponentChildren;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        class={`p-1.5 rounded-lg cursor-pointer transition-colors ${
          checked
            ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
            : "text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        }`}
        onClick={() => onChange(!checked)}
        aria-label={label}
        aria-pressed={checked}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function TagsView() {
  const tags = allTags.value;
  const selected = activeTag.value;
  const [showConfirm, setShowConfirm] = useState(false);
  const [newTag, setNewTag] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isSelectMode = tagsSelectMode.value;
  const selectedCount = tagsSelectedNotes.value.size;

  const enterSelectMode = () => {
    tagsSelectMode.value = true;
    tagsSelectedNotes.value = new Set();
    setNewTag("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const exitSelectMode = () => {
    tagsSelectMode.value = false;
    tagsSelectedNotes.value = new Set();
    setNewTag("");
  };

  const handleApply = async () => {
    const trimmed = newTag.trim().toLowerCase();
    if (!trimmed || selectedCount === 0) return;
    await addTagToNotes(trimmed, tagsSelectedNotes.value);
    exitSelectMode();
  };

  const handleDelete = async () => {
    if (!selected) return;
    await deleteTag(selected);
    setShowConfirm(false);
  };

  if (isSelectMode) {
    return (
      <div class="mb-6">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            Add tag
          </span>
          <input
            ref={inputRef}
            type="text"
            class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg outline-none min-w-[140px]"
            placeholder="Tag name..."
            value={newTag}
            onInput={(e) => setNewTag((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleApply();
              if (e.key === "Escape") exitSelectMode();
            }}
          />
          <span class="text-sm text-gray-500 dark:text-gray-400">
            to {selectedCount} {selectedCount === 1 ? "note" : "notes"}
          </span>
          <button
            type="button"
            class={`px-3 py-1.5 text-sm rounded-lg font-medium cursor-pointer transition-colors ${
              newTag.trim() && selectedCount > 0
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed"
            }`}
            onClick={handleApply}
            disabled={!newTag.trim() || selectedCount === 0}
          >
            Apply
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded-lg font-medium bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 cursor-pointer transition-colors"
            onClick={exitSelectMode}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="mb-6">
      <div class="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          class={`px-3 py-1.5 text-sm rounded-lg cursor-pointer transition-colors ${
            !selected
              ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400"
              : "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
          onClick={() => {
            activeTag.value = null;
            setShowConfirm(false);
          }}
        >
          All
        </button>
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            class={`px-3 py-1.5 text-sm rounded-lg cursor-pointer transition-colors ${
              selected === tag
                ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400"
                : "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
            onClick={() => {
              activeTag.value = tag;
              setShowConfirm(false);
            }}
          >
            #{tag}
          </button>
        ))}

        {selected && !showConfirm && (
          <Tooltip label="Delete tag">
            <button
              type="button"
              class="p-1.5 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer transition-colors"
              onClick={() => setShowConfirm(true)}
              aria-label="Delete tag"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </Tooltip>
        )}

        {selected && showConfirm && (
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-500 dark:text-gray-400">
              Remove #{selected} from all notes?
            </span>
            <button
              type="button"
              class="px-2 py-1 text-xs bg-red-600 text-white rounded font-medium hover:bg-red-700 cursor-pointer"
              onClick={handleDelete}
            >
              Delete
            </button>
            <button
              type="button"
              class="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 rounded font-medium hover:bg-gray-300 dark:hover:bg-gray-500 cursor-pointer"
              onClick={() => setShowConfirm(false)}
            >
              Cancel
            </button>
          </div>
        )}

        <Tooltip label="Add tag to notes">
          <button
            type="button"
            class="p-1.5 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer transition-colors"
            onClick={enterSelectMode}
            aria-label="Add tag to notes"
          >
            <Plus class="w-4 h-4" />
          </button>
        </Tooltip>

        <div class="flex-1" />

        <div class="flex items-center gap-1">
          <MiniToggle
            checked={tagsShowArchived.value}
            onChange={(v) => {
              tagsShowArchived.value = v;
            }}
            label={
              tagsShowArchived.value
                ? "Hide archived notes"
                : "Show archived notes"
            }
          >
            <Archive class="w-4 h-4" />
          </MiniToggle>
          <MiniToggle
            checked={tagsShowTrashed.value}
            onChange={(v) => {
              tagsShowTrashed.value = v;
            }}
            label={
              tagsShowTrashed.value
                ? "Hide trashed notes"
                : "Show trashed notes"
            }
          >
            <Trash2 class="w-4 h-4" />
          </MiniToggle>
        </div>
      </div>

      {tags.length === 0 && (
        <p class="mt-4 text-sm text-gray-400 dark:text-gray-500">
          No tags yet. Add tags to your notes to organize them.
        </p>
      )}
    </div>
  );
}
