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
import { menuPanelClass, NoteMenu } from "./NoteMenu.tsx";
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

/** The editor's font picker, from the card: the same "Aa" in each font. */
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
  leaving,
}: {
  note: Note;
  anchorRef: Anchor;
  onClose: () => void;
  onShowVersions: (() => void) | undefined;
  leaving: boolean;
}) {
  return (
    <CardPopover anchorRef={anchorRef} onClose={onClose} leaving={leaving}>
      <div class={menuPanelClass}>
        <NoteMenu
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
 * Whichever of a card's popovers is drawn: the open one, or the one just
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
  /** Opens the note's editor on its history; left out where it has none. */
  onShowVersions?: (() => void) | undefined;
}) {
  const close = () => setOpen(null);
  return (
    <>
      {shown === "color" && (
        <CardColorPicker
          note={note}
          anchorRef={colorBtnRef}
          onClose={close}
          leaving={leaving}
        />
      )}

      {shown === "font" && (
        <CardFontPicker
          note={note}
          anchorRef={fontBtnRef}
          onClose={close}
          leaving={leaving}
        />
      )}

      {shown === "tags" && (
        <CardPopover anchorRef={tagsBtnRef} onClose={close} leaving={leaving}>
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
          leaving={leaving}
        />
      )}

      {shown === "reminder" && (
        <CardPopover
          anchorRef={reminderAnchorRef}
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
