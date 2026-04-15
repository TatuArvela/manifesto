import { Archive, Trash2 } from "lucide-preact";
import { useState } from "preact/hooks";
import {
  activeTag,
  allTags,
  deleteTag,
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

  const handleDelete = async () => {
    if (!selected) return;
    await deleteTag(selected);
    setShowConfirm(false);
  };

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
