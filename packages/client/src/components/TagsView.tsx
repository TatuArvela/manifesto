import {
  NoteColor,
  normalizeTag,
  tagLeaf,
  tagLineage,
} from "@manifesto/shared";
import type { LucideIcon } from "lucide-preact";
import {
  Archive,
  CornerDownRight,
  Eye,
  EyeOff,
  Palette,
  Pencil,
  StickyNote,
  Trash2,
} from "lucide-preact";
import { useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { getColorPickerColors, plural, t } from "../i18n/index.js";
import { askConfirmation } from "../state/confirm.js";
import {
  activeTag,
  allTags,
  childTags,
  deleteTag,
  hiddenTags,
  hiddenThrough,
  notesLoaded,
  renameTag,
  setTagColor,
  setTagHidden,
  showError,
  type TagColor,
  tagColors,
  tagCounts,
  tagsShowActive,
  tagsShowArchived,
  tagsShowTrashed,
} from "../state/index.js";
import { Dropdown } from "./Dropdown.js";
import { TagDot } from "./TagDot.js";
import { Tooltip } from "./Tooltip.js";

const actionClass =
  "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full cursor-pointer transition-colors text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600";

function Chip({
  selected,
  open = false,
  onClick,
  icon: Icon,
  children,
  ariaLabel,
}: {
  selected: boolean;
  /** On the way to the selected tag: one of the tags above it. */
  open?: boolean;
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
          : open
            ? "bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 ring-1 ring-blue-400"
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
  const next = normalizeTag(name);

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

/**
 * The colour of the selected tag: the note colours, with the plain one
 * standing for no colour at all.
 */
function TagColorButton({ tag }: { tag: string }) {
  const [open, setOpen] = useState(false);
  const current = tagColors.value[tag] ?? NoteColor.Default;
  // "Default" is a note's own word; on a tag the plain swatch is no colour.
  const label = (c: { value: NoteColor; label: string }) =>
    c.value === NoteColor.Default ? t("tags.noColor") : c.label;
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      panelClass="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1 flex-wrap max-w-64"
      trigger={
        <button
          type="button"
          class={actionClass}
          onClick={() => setOpen(!open)}
          aria-haspopup="true"
          aria-expanded={open}
        >
          <Palette class="w-4 h-4" />
          {t("tags.color")}
        </button>
      }
    >
      {getColorPickerColors().map((c) => (
        <Tooltip key={c.value} label={label(c)}>
          <button
            type="button"
            class={`w-7 h-7 rounded-full cursor-pointer ${c.swatch} ${current === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
            aria-label={label(c)}
            aria-pressed={current === c.value}
            onClick={() => {
              const color =
                c.value === NoteColor.Default ? null : (c.value as TagColor);
              if (!setTagColor(tag, color)) showError(t("tags.colorLimit"));
              setOpen(false);
            }}
          />
        </Tooltip>
      ))}
    </Dropdown>
  );
}

/** One tag in a row of the tree, with its count and what marks it. */
function TagChip({
  tag,
  depth,
  onSelect,
}: {
  tag: string;
  /** 0 for the top row, which shows the whole tag; below it, the last part. */
  depth: number;
  onSelect: () => void;
}) {
  const selected = activeTag.value;
  const count = tagCounts.value.get(tag) ?? 0;
  const isHidden = hiddenThrough(tag) !== null;
  return (
    <Chip
      selected={selected === tag}
      open={selected !== null && tagLineage(selected).includes(tag)}
      onClick={onSelect}
      ariaLabel={[
        `#${tag}`,
        plural("tags.noteCount", count),
        ...(isHidden ? [t("tags.hidden")] : []),
      ].join(", ")}
    >
      {isHidden && <EyeOff class="w-3.5 h-3.5 opacity-60" aria-hidden="true" />}
      <TagDot tag={tag} />
      <span class={isHidden ? "opacity-70" : undefined}>
        {depth === 0 ? `#${tag}` : tagLeaf(tag)}
      </span>
      <span class="text-xs tabular-nums opacity-60">{count}</span>
    </Chip>
  );
}

export function TagsView() {
  const tags = allTags.value;
  const selected = activeTag.value;
  const selectedHidden =
    selected !== null && hiddenTags.value.includes(selected);
  // Hidden because a tag above it is: that tag is where to show it again.
  const hiddenBy = selected === null ? null : hiddenThrough(selected);
  const [renaming, setRenaming] = useState(false);

  const select = (tag: string | null) => {
    activeTag.value = tag;
    setRenaming(false);
  };

  // The tree as rows of chips: the top-level tags, then for each tag on the
  // way to the selected one, and for the selected one itself, the tags
  // directly under it. A row a tag has no children for is not drawn.
  const subRows = (selected ? tagLineage(selected) : [])
    .map((parent) => ({ parent, children: childTags(parent) }))
    .filter((row) => row.children.length > 0);

  const handleDelete = async () => {
    if (!selected) return;
    const nested = childTags(selected).length > 0;
    const ok = await askConfirmation({
      title: t(nested ? "tags.removeConfirmNested" : "tags.removeConfirm", {
        tag: selected,
      }),
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
        <Chip selected={!selected} onClick={() => select(null)}>
          {t("tags.all")}
        </Chip>
        {childTags(null).map((tag) => (
          <TagChip key={tag} tag={tag} depth={0} onSelect={() => select(tag)} />
        ))}
      </div>

      {subRows.map(({ parent, children }, i) => (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring a border and a legend to a row of chips
        <div
          key={parent}
          role="group"
          data-tags-under={parent}
          aria-label={t("tags.under", { tag: parent })}
          class="flex items-center gap-2 flex-wrap"
          style={{ paddingLeft: `${Math.min(i, 3) * 0.75}rem` }}
        >
          <span
            class="inline-flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 mr-1"
            aria-hidden="true"
          >
            <CornerDownRight class="w-3.5 h-3.5" />
            {tagLeaf(parent)}
          </span>
          {children.map((tag) => (
            <TagChip
              key={tag}
              tag={tag}
              depth={i + 1}
              onSelect={() => select(tag)}
            />
          ))}
        </div>
      ))}

      {selected && renaming && (
        <RenameTagForm
          key={selected}
          tag={selected}
          onDone={() => setRenaming(false)}
        />
      )}

      {selected && !renaming && (
        <div class="flex items-center gap-2 flex-wrap">
          {hiddenBy === null || hiddenBy === selected ? (
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
          ) : null}
          <TagColorButton key={selected} tag={selected} />
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
          {hiddenBy !== null && (
            <p class="basis-full text-sm text-neutral-600 dark:text-neutral-300">
              {hiddenBy === selected
                ? t("tags.hiddenHint", { tag: selected })
                : t("tags.hiddenByParent", { tag: selected, parent: hiddenBy })}
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
