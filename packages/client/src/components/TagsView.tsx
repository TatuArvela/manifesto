import {
  NoteColor,
  normalizeTag,
  tagLeaf,
  tagLineage,
} from "@manifesto/shared";
import type { LucideIcon } from "lucide-preact";
import {
  Archive,
  ChevronRight,
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
  tagColorOf,
  tagColors,
  tagCounts,
  tagsShowActive,
  tagsShowArchived,
  tagsShowTrashed,
} from "../state/index.js";
import { Dropdown } from "./Dropdown.js";
import { tagTint } from "./TagChip.js";
import { Tooltip } from "./Tooltip.js";

// The actions on the selected tag are a list under the tree, flat so they are
// not taken for more tags.
const actionClass =
  "flex items-center gap-2.5 w-full px-3 py-1.5 text-sm text-left rounded-lg cursor-pointer transition-colors text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800";

/** A filter of the view: which of the notes of a tag are shown. */
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

// Every tag of the tree is a chip, as it is on a note: an uncoloured one in
// this, a coloured one in its colour.
const plainChip = "bg-neutral-200/70 dark:bg-neutral-600/60";

const rowClass = (selected: boolean) =>
  `flex items-center rounded-lg ${
    selected
      ? "bg-neutral-100 dark:bg-neutral-700/70 font-medium"
      : "hover:bg-neutral-50 dark:hover:bg-neutral-700/30"
  }`;

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
      <button
        type="button"
        class="px-3 py-1.5 text-sm rounded-lg cursor-pointer text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        onClick={onDone}
      >
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

/**
 * One tag of the tree on a line of its own, and under it, while it is open,
 * the tags directly beneath. The line is what is selected; the tag's colour is
 * on its name alone, so a selected tag and a blue one are not alike.
 */
function TagNode({
  tag,
  depth,
  isOpen,
  onToggle,
  onSelect,
}: {
  tag: string;
  /** 0 for a top-level tag, which shows whole; below it, the last part. */
  depth: number;
  isOpen: (tag: string) => boolean;
  onToggle: (tag: string) => void;
  onSelect: (tag: string) => void;
}) {
  const count = tagCounts.value.get(tag) ?? 0;
  const isHidden = hiddenThrough(tag) !== null;
  const color = tagColorOf(tag);
  const children = childTags(tag);
  const open = children.length > 0 && isOpen(tag);
  return (
    <li>
      <div
        class={rowClass(activeTag.value === tag)}
        style={{ paddingLeft: `${Math.min(depth, 6) * 1.5}rem` }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            class="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md cursor-pointer opacity-60 hover:opacity-100"
            aria-expanded={open}
            aria-label={t(open ? "tags.collapse" : "tags.expand", { tag })}
            onClick={() => onToggle(tag)}
          >
            <ChevronRight
              class={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span class="w-7 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          class="flex-1 min-w-0 flex items-center py-1 pr-2 text-sm text-left cursor-pointer"
          data-tag-color={color}
          aria-pressed={activeTag.value === tag}
          aria-label={[
            `#${tag}`,
            plural("tags.noteCount", count),
            ...(isHidden ? [t("tags.hidden")] : []),
          ].join(", ")}
          onClick={() => onSelect(tag)}
        >
          <span
            class={`min-w-0 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ${tagTint(tag, plainChip)} ${isHidden ? "opacity-70" : ""}`}
          >
            {isHidden && (
              <EyeOff
                class="w-3.5 h-3.5 shrink-0 opacity-70"
                aria-hidden="true"
              />
            )}
            <span class="truncate">
              {depth === 0 ? `#${tag}` : tagLeaf(tag)}
            </span>
            <span class="text-xs tabular-nums opacity-60">{count}</span>
          </span>
        </button>
      </div>
      {open && (
        <ul data-tags-under={tag} aria-label={t("tags.under", { tag })}>
          {children.map((child) => (
            <TagNode
              key={child}
              tag={child}
              depth={depth + 1}
              isOpen={isOpen}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TagsView({
  pane = false,
}: {
  /**
   * As the sidebar, which is as tall as the window and scrolls as a whole.
   * Without it, above the notes on a phone, the tree scrolls by itself so
   * the notes are never far below.
   */
  pane?: boolean;
}) {
  const tags = allTags.value;
  const selected = activeTag.value;
  const selectedHidden =
    selected !== null && hiddenTags.value.includes(selected);
  // Hidden because a tag above it is: that tag is where to show it again.
  const hiddenBy = selected === null ? null : hiddenThrough(selected);
  const [renaming, setRenaming] = useState(false);
  // A tag is open when it is the selected one or on the way to it, so the
  // selection is always in sight, a link to a nested tag included. The chevron
  // overrides that for one tag, until the next selection through it.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const lineage = selected ? tagLineage(selected) : [];
  const isOpen = (tag: string) => toggled.get(tag) ?? lineage.includes(tag);

  const toggle = (tag: string) =>
    setToggled(new Map(toggled).set(tag, !isOpen(tag)));

  const select = (tag: string | null) => {
    activeTag.value = tag;
    setRenaming(false);
    if (tag === null) return;
    const next = new Map(toggled);
    for (const at of tagLineage(tag)) next.delete(at);
    setToggled(next);
  };

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
    // Plain rows either way: whoever mounts it supplies the surface, the
    // shell's own, so the tree looks the same beside the notes and above them.
    <div class="flex flex-col gap-3 py-2">
      <div>
        <ul
          class={pane ? "px-2" : "px-2 max-h-[45vh] overflow-y-auto"}
          aria-label={t("nav.tags")}
        >
          <li>
            <div class={rowClass(!selected)}>
              <span class="w-7 shrink-0" aria-hidden="true" />
              <button
                type="button"
                class="flex-1 py-1 pr-2 text-sm text-left cursor-pointer"
                aria-pressed={!selected}
                onClick={() => select(null)}
              >
                <span
                  class={`inline-block px-2.5 py-0.5 rounded-full ${plainChip}`}
                >
                  {t("tags.all")}
                </span>
              </button>
            </div>
          </li>
          {childTags(null).map((tag) => (
            <TagNode
              key={tag}
              tag={tag}
              depth={0}
              isOpen={isOpen}
              onToggle={toggle}
              onSelect={select}
            />
          ))}
        </ul>

        {selected && renaming && (
          <div class="mt-2 border-t border-neutral-200 dark:border-neutral-700 p-3">
            <RenameTagForm
              key={selected}
              tag={selected}
              onDone={() => setRenaming(false)}
            />
          </div>
        )}

        {selected && !renaming && (
          <div class="mt-2 border-t border-neutral-200 dark:border-neutral-700 px-2 pt-2 flex flex-col items-stretch gap-0.5">
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
                {selectedHidden
                  ? t("tags.showInNotes")
                  : t("tags.hideFromNotes")}
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
              <p class="px-3 pt-1 text-sm text-neutral-600 dark:text-neutral-300">
                {hiddenBy === selected
                  ? t("tags.hiddenHint", { tag: selected })
                  : t("tags.hiddenByParent", {
                      tag: selected,
                      parent: hiddenBy,
                    })}
              </p>
            )}
          </div>
        )}
      </div>

      <div class="flex items-center gap-2 flex-wrap px-3 pt-3 pb-1 border-t border-neutral-200 dark:border-neutral-700">
        <span class="basis-full text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
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
        <p class="px-3 text-sm text-neutral-400 dark:text-neutral-500">
          {t("tags.empty")}
        </p>
      )}
    </div>
  );
}
