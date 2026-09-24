import type { LucideIcon } from "lucide-preact";
import {
  Archive,
  Eye,
  EyeOff,
  Pencil,
  StickyNote,
  Trash2,
} from "lucide-preact";
import { useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { plural, t } from "../i18n/index.js";
import { askConfirmation } from "../state/confirm.js";
import {
  activeTag,
  allTags,
  deleteTag,
  hiddenTags,
  notesLoaded,
  renameTag,
  setTagHidden,
  tagCounts,
  tagsShowActive,
  tagsShowArchived,
  tagsShowTrashed,
} from "../state/index.js";

const actionClass =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full cursor-pointer transition-colors text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600";

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

/**
 * Renames the selected tag on every note. Normalized the way the tag picker
 * does it, so a rename cannot make a tag the picker would never have made.
 */
function RenameTagForm({ tag, onDone }: { tag: string; onDone: () => void }) {
  const [name, setName] = useState(tag);
  const [busy, setBusy] = useState(false);
  useEscapeStack(true, onDone);
  const next = name.trim().toLowerCase();

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy || !next) return;
    setBusy(true);
    await renameTag(tag, next);
    setBusy(false);
    onDone();
  };

  return (
    <form onSubmit={submit} class="flex items-center gap-2 flex-wrap">
      <label class="flex-1 min-w-40">
        <span class="sr-only">{t("tags.renameLabel", { tag })}</span>
        <input
          type="text"
          value={name}
          maxLength={64}
          // biome-ignore lint/a11y/noAutofocus: opened by the Rename button, to type into
          autoFocus
          onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          class="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>
      <button
        type="submit"
        disabled={busy || !next}
        class="px-3 py-1.5 text-sm rounded-lg font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white cursor-pointer"
      >
        {t("tags.renameSubmit")}
      </button>
      <button type="button" class={actionClass} onClick={onDone}>
        {t("tags.cancel")}
      </button>
    </form>
  );
}

export function TagsView() {
  const tags = allTags.value;
  const counts = tagCounts.value;
  const hidden = new Set(hiddenTags.value);
  const selected = activeTag.value;
  const selectedHidden = selected !== null && hidden.has(selected);
  const [renaming, setRenaming] = useState(false);

  const handleDelete = async () => {
    if (!selected) return;
    const ok = await askConfirmation({
      title: t("tags.removeConfirm", { tag: selected }),
      confirmLabel: t("tags.confirmDelete"),
    });
    if (ok) await deleteTag(selected);
  };

  return (
    // Centred in the same column in grid mode as in list mode, like the search
    // filters: the notes below spread across the grid, the controls do not.
    <div class="mt-4 mb-6 flex flex-col gap-3 w-full max-w-xl mx-auto">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="hidden md:inline text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mr-1">
          {t("nav.tags")}
        </span>
        <Chip
          selected={!selected}
          onClick={() => {
            activeTag.value = null;
            setRenaming(false);
          }}
        >
          {t("tags.all")}
        </Chip>
        {tags.map((tag) => {
          const count = counts.get(tag) ?? 0;
          const isHidden = hidden.has(tag);
          return (
            <Chip
              key={tag}
              selected={selected === tag}
              onClick={() => {
                activeTag.value = tag;
                setRenaming(false);
              }}
              ariaLabel={[
                `#${tag}`,
                plural("tags.noteCount", count),
                ...(isHidden ? [t("tags.hidden")] : []),
              ].join(", ")}
            >
              {isHidden && (
                <EyeOff class="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
              )}
              <span class={isHidden ? "opacity-70" : undefined}>#{tag}</span>
              <span class="text-xs tabular-nums opacity-60">{count}</span>
            </Chip>
          );
        })}
      </div>

      {selected && renaming && (
        <RenameTagForm
          key={selected}
          tag={selected}
          onDone={() => setRenaming(false)}
        />
      )}

      {selected && !renaming && (
        <div class="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            class={actionClass}
            onClick={() => setTagHidden(selected, !selectedHidden)}
            aria-pressed={selectedHidden}
          >
            {selectedHidden ? (
              <Eye class="w-4 h-4" />
            ) : (
              <EyeOff class="w-4 h-4" />
            )}
            {selectedHidden ? t("tags.showInNotes") : t("tags.hideFromNotes")}
          </button>
          <button
            type="button"
            class={actionClass}
            onClick={() => setRenaming(true)}
          >
            <Pencil class="w-4 h-4" />
            {t("tags.rename")}
          </button>
          <button
            type="button"
            class={`${actionClass} hover:text-red-600 dark:hover:text-red-400`}
            onClick={handleDelete}
          >
            <Trash2 class="w-4 h-4" />
            {t("tags.delete")}
          </button>
          {selectedHidden && (
            <p class="basis-full text-sm text-neutral-600 dark:text-neutral-300">
              {t("tags.hiddenHint", { tag: selected })}
            </p>
          )}
        </div>
      )}

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

      {tags.length === 0 && notesLoaded.value && (
        <p class="text-sm text-neutral-400 dark:text-neutral-500">
          {t("tags.empty")}
        </p>
      )}
    </div>
  );
}
