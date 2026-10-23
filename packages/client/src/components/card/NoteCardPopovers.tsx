import { type Note, type NoteColor, NoteFont } from "@manifesto/shared";
import { noteFontFamilies } from "#/colors.ts";
import { CardPopover } from "#/components/Popover.tsx";
import { ReminderPickerPanel } from "#/components/ReminderPicker.tsx";
import { TagPicker, tagPickerPanelClass } from "#/components/TagPicker.tsx";
import { Tooltip } from "#/components/Tooltip.tsx";
import { getColorPickerColors, getFontLabel } from "#/i18n/index.ts";
import {
  addTag,
  deleteCheckedItems,
  sortItemsByDate,
  uncheckAll,
} from "#/state/actions.ts";
import { updateNote } from "#/state/notesStore.ts";
import { hasDatedItems } from "#/utils/itemDate.ts";
import { hasCheckedItems } from "#/utils/markdown.ts";
import type { CardAction } from "./cardActionsFit.ts";
import { cardActionLook } from "./NoteCardControls.tsx";
import {
  menuDividerClass,
  menuItemClass,
  menuPanelClass,
  NoteMenu,
} from "./NoteMenu.tsx";
import { noteMenuItems } from "./noteMenuItems.tsx";

export type CardPopoverKind = "color" | "font" | "tags" | "menu" | "reminder";

type Anchor = preact.RefObject<HTMLButtonElement | null>;

function CardColorPicker({
  note,
  anchorRef,
  onClose,
  leaving,
}: {
  note: Note;
  anchorRef: Anchor;
  onClose: () => void;
  leaving: boolean;
}) {
  const pickerColors = getColorPickerColors();
  return (
    <CardPopover anchorRef={anchorRef} onClose={onClose} leaving={leaving}>
      <div class="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1">
        {pickerColors.map((c) => (
          <Tooltip key={c.value} label={c.label}>
            <button
              type="button"
              class={`w-6 h-6 rounded-full cursor-pointer ${c.swatch} ${note.color === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
              onClick={() => {
                void updateNote(note.id, { color: c.value as NoteColor });
                onClose();
              }}
              aria-label={c.label}
              aria-pressed={note.color === c.value}
            />
          </Tooltip>
        ))}
      </div>
    </CardPopover>
  );
}

/** The font picker of the editor, from the card: the same "Aa" in each font. */
function CardFontPicker({
  note,
  anchorRef,
  onClose,
  leaving,
}: {
  note: Note;
  anchorRef: Anchor;
  onClose: () => void;
  leaving: boolean;
}) {
  return (
    <CardPopover anchorRef={anchorRef} onClose={onClose} leaving={leaving}>
      <div class="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1">
        {Object.values(NoteFont).map((f) => {
          const label = getFontLabel(f);
          return (
            <Tooltip key={f} label={label}>
              <button
                type="button"
                class={`px-2 py-1 text-sm rounded cursor-pointer ${note.font === f ? "ring-2 ring-blue-500 ring-offset-1" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                style={{ fontFamily: noteFontFamilies[f] || undefined }}
                onClick={() => {
                  void updateNote(note.id, { font: f });
                  onClose();
                }}
                aria-label={label}
                aria-pressed={note.font === f}
              >
                Aa
              </button>
            </Tooltip>
          );
        })}
      </div>
    </CardPopover>
  );
}

function CardMenu({
  note,
  anchorRef,
  onClose,
  onShowVersions,
  overflow,
  onOverflow,
  leaving,
}: {
  note: Note;
  anchorRef: Anchor;
  onClose: () => void;
  onShowVersions: (() => void) | undefined;
  overflow: CardAction[];
  onOverflow: (action: CardAction) => void;
  leaving: boolean;
}) {
  // Not `NoteMenuAction` rows: `NoteMenu` closes the menu after each of those,
  // and most of these open a different panel in its place.
  const overflowRows = overflow.length > 0 && (
    <>
      {overflow.map((action) => {
        const { icon: Icon, label } = cardActionLook(action, note);
        return (
          <button
            key={action}
            type="button"
            class={menuItemClass}
            data-menu-row={action}
            onClick={() => onOverflow(action)}
          >
            <Icon class="w-4 h-4" />
            {label}
          </button>
        );
      })}
      <div class={menuDividerClass} />
    </>
  );
  return (
    <CardPopover anchorRef={anchorRef} onClose={onClose} leaving={leaving}>
      <div class={menuPanelClass}>
        <NoteMenu
          before={overflowRows}
          items={noteMenuItems(note, {
            onShowVersions,
            checkedItems: {
              present: hasCheckedItems(note.content),
              remove: () => deleteCheckedItems(note.id),
              uncheck: () => uncheckAll(note.id),
            },
            datedItems: {
              present: hasDatedItems(note.content),
              sort: () => sortItemsByDate(note.id),
            },
          })}
          onClose={onClose}
        />
      </div>
    </CardPopover>
  );
}

/**
 * The popover of a card that is drawn: the open one, or the one that just
 * closed while it fades (`shown` and `leaving` come from `usePresence`).
 */
export function NoteCardPopovers({
  note,
  shown,
  leaving,
  setOpen,
  colorBtnRef,
  fontBtnRef,
  tagsBtnRef,
  menuBtnRef,
  reminderAnchorRef,
  onShowVersions,
  overflow,
  onOverflow,
}: {
  note: Note;
  shown: CardPopoverKind | null;
  leaving: boolean;
  setOpen: (
    next:
      | CardPopoverKind
      | null
      | ((open: CardPopoverKind | null) => CardPopoverKind | null),
  ) => void;
  colorBtnRef: Anchor;
  fontBtnRef: Anchor;
  tagsBtnRef: Anchor;
  menuBtnRef: Anchor;
  /** The reminder chip or the bell, whichever opened the picker. */
  reminderAnchorRef: Anchor;
  /**
   * Opens the editor of the note on its history. Not given where it has none.
   */
  onShowVersions?: (() => void) | undefined;
  /** The buttons that did not fit on the row, which the menu shows. */
  overflow: CardAction[];
  onOverflow: (action: CardAction) => void;
}) {
  const close = () => setOpen(null);
  // A button that did not fit is not on the page. Its panel then opens from
  // the menu button, from which it was picked.
  const from = (ref: Anchor) => (ref.current ? ref : menuBtnRef);
  return (
    <>
      {shown === "color" && (
        <CardColorPicker
          note={note}
          anchorRef={from(colorBtnRef)}
          onClose={close}
          leaving={leaving}
        />
      )}

      {shown === "font" && (
        <CardFontPicker
          note={note}
          anchorRef={from(fontBtnRef)}
          onClose={close}
          leaving={leaving}
        />
      )}

      {shown === "tags" && (
        <CardPopover
          anchorRef={from(tagsBtnRef)}
          onClose={close}
          leaving={leaving}
        >
          <div class={tagPickerPanelClass}>
            <TagPicker
              tags={note.tags}
              autoFocus
              onAddTag={(tag) => addTag(note.id, tag)}
            />
          </div>
        </CardPopover>
      )}

      {shown === "menu" && (
        <CardMenu
          note={note}
          anchorRef={menuBtnRef}
          onClose={close}
          onShowVersions={onShowVersions}
          overflow={overflow}
          onOverflow={onOverflow}
          leaving={leaving}
        />
      )}

      {shown === "reminder" && (
        <CardPopover
          anchorRef={from(reminderAnchorRef)}
          onClose={close}
          leaving={leaving}
        >
          <div class="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 w-72">
            <ReminderPickerPanel
              reminder={note.reminder}
              onChange={(reminder) => updateNote(note.id, { reminder })}
              onDone={close}
            />
          </div>
        </CardPopover>
      )}
    </>
  );
}
