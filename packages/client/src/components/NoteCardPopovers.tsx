import type { Note, NoteColor } from "@manifesto/shared";
import { getColorPickerColors } from "../i18n/index.js";
import { addTag, deleteCheckedItems, updateNote } from "../state/index.js";
import { hasCheckedItems } from "../utils/markdown.js";
import { menuPanelClass, NoteMenu, noteMenuItems } from "./NoteMenu.js";
import { CardPopover } from "./Popover.js";
import { ReminderPickerPanel } from "./ReminderPicker.js";
import { TagPicker, tagPickerPanelClass } from "./TagPicker.js";
import { Tooltip } from "./Tooltip.js";

export type CardPopoverKind = "color" | "tags" | "menu" | "reminder";

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
                updateNote(note.id, { color: c.value as NoteColor });
                onClose();
              }}
              aria-label={c.label}
            />
          </Tooltip>
        ))}
      </div>
    </CardPopover>
  );
}

function CardMenu({
  note,
  anchorRef,
  onClose,
  onOpenReminder,
  leaving,
}: {
  note: Note;
  anchorRef: Anchor;
  onClose: () => void;
  onOpenReminder: () => void;
  leaving: boolean;
}) {
  return (
    <CardPopover anchorRef={anchorRef} onClose={onClose} leaving={leaving}>
      <div class={menuPanelClass}>
        <NoteMenu
          items={noteMenuItems(note, {
            onOpenReminder,
            checkedItems: {
              present: hasCheckedItems(note.content),
              remove: () => deleteCheckedItems(note.id),
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
  tagsBtnRef,
  menuBtnRef,
  reminderAnchorRef,
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
  tagsBtnRef: Anchor;
  menuBtnRef: Anchor;
  /** The reminder chip where there is one to anchor on, else the menu button. */
  reminderAnchorRef: Anchor;
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
          // Only if the menu is still what is open: the menu closes itself
          // after every item, and "Remind me" has by then handed over to
          // the reminder picker, which a plain close took down with it.
          onClose={() => setOpen((open) => (open === "menu" ? null : open))}
          onOpenReminder={() => setOpen("reminder")}
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
