import type { LucideIcon } from "lucide-preact";
import { Archive, StickyNote, Trash2 } from "lucide-preact";
import { useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import {
  activeTag,
  allTags,
  deleteTag,
  tagsShowActive,
  tagsShowArchived,
  tagsShowTrashed,
} from "../state/index.js";
import { Tooltip } from "./Tooltip.js";

function Chip({
  selected,
  onClick,
  icon: Icon,
  children,
  ariaLabel,
}: {
  selected: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  children: preact.ComponentChildren;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      class={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full cursor-pointer transition-colors ${
        selected
          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400"
          : "bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600"
      }`}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={ariaLabel}
    >
      {Icon && <Icon class="w-4 h-4" />}
      {children}
    </button>
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
    <div class="mt-4 mb-6 flex flex-col gap-3">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="hidden md:inline text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mr-1">
          {t("nav.tags")}
        </span>
        <Chip
          selected={!selected}
          onClick={() => {
            activeTag.value = null;
            setShowConfirm(false);
          }}
        >
          {t("tags.all")}
        </Chip>
        {tags.map((tag) => (
          <Chip
            key={tag}
            selected={selected === tag}
            onClick={() => {
              activeTag.value = tag;
              setShowConfirm(false);
            }}
          >
            #{tag}
          </Chip>
        ))}

        {selected && !showConfirm && (
          <Tooltip label={t("tags.delete")}>
            <button
              type="button"
              class="p-1.5 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer transition-colors"
              onClick={() => setShowConfirm(true)}
              aria-label={t("tags.delete")}
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </Tooltip>
        )}

        {selected && showConfirm && (
          <div class="flex items-center gap-2">
            <span class="text-sm text-neutral-500 dark:text-neutral-400">
              {t("tags.removeConfirm", { tag: selected })}
            </span>
            <button
              type="button"
              class="px-2 py-1 text-xs bg-red-600 text-white rounded font-medium hover:bg-red-700 cursor-pointer"
              onClick={handleDelete}
            >
              {t("tags.confirmDelete")}
            </button>
            <button
              type="button"
              class="px-2 py-1 text-xs bg-neutral-200 dark:bg-neutral-600 rounded font-medium hover:bg-neutral-300 dark:hover:bg-neutral-500 cursor-pointer"
              onClick={() => setShowConfirm(false)}
            >
              {t("tags.cancel")}
            </button>
          </div>
        )}
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <span class="hidden md:inline text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mr-1">
          {t("search.filterByLocation")}
        </span>
        <Chip
          selected={tagsShowActive.value}
          onClick={() => {
            tagsShowActive.value = !tagsShowActive.value;
          }}
          icon={StickyNote}
          ariaLabel={t("search.location.active")}
        >
          <span class="hidden md:inline">{t("search.location.active")}</span>
        </Chip>
        <Chip
          selected={tagsShowArchived.value}
          onClick={() => {
            tagsShowArchived.value = !tagsShowArchived.value;
          }}
          icon={Archive}
          ariaLabel={
            tagsShowArchived.value
              ? t("tags.hideArchived")
              : t("tags.showArchived")
          }
        >
          <span class="hidden md:inline">{t("search.location.archived")}</span>
        </Chip>
        <Chip
          selected={tagsShowTrashed.value}
          onClick={() => {
            tagsShowTrashed.value = !tagsShowTrashed.value;
          }}
          icon={Trash2}
          ariaLabel={
            tagsShowTrashed.value
              ? t("tags.hideTrashed")
              : t("tags.showTrashed")
          }
        >
          <span class="hidden md:inline">{t("search.location.trashed")}</span>
        </Chip>
      </div>

      {tags.length === 0 && (
        <p class="text-sm text-neutral-400 dark:text-neutral-500">
          {t("tags.empty")}
        </p>
      )}
    </div>
  );
}
