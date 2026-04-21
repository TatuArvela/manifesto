import { useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import { allTags } from "../state/index.js";

/**
 * Inline tag picker with a text input and list of existing tags.
 * Used in the selection toolbar, card kebab menu, and note editor menu.
 */
export function TagPicker({
  tags,
  onAddTag,
}: {
  /** Currently applied tags (to filter them out of the suggestion list) */
  tags: string[];
  /** Called with the trimmed, lowercased tag string */
  onAddTag: (tag: string) => void;
}) {
  const [newTag, setNewTag] = useState("");

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
        type="text"
        class="w-full px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded outline-none mb-1"
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
            class="block w-full text-left px-2 py-1 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
            onClick={() => handleAdd(tag)}
          >
            #{tag}
          </button>
        ))}
    </div>
  );
}
