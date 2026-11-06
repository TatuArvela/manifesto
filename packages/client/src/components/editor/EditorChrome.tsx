import { type NoteReminder, reminderDone } from "@manifesto/shared";
import { ArrowLeft, Pin, PinOff } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { buttonClass } from "#/components/buttonClasses.ts";
import { CARD_POPOVER_EXIT_MS, CardPopover } from "#/components/Popover.tsx";
import { ReminderChip } from "#/components/ReminderChip.tsx";
import { ReminderPickerPanel } from "#/components/ReminderPicker.tsx";
import { TagChip } from "#/components/TagChip.tsx";
import { Tooltip } from "#/components/Tooltip.tsx";
import { usePresence } from "#/hooks/usePresence.ts";
import { t } from "#/i18n/index.ts";
import { editorButtonClass, editorIconClass } from "./editorButtons.ts";

/** The parts of `NoteEditor` around the text: its top bar, chips and notices. */

/**
 * Back (only on a phone) and the pin. On a wide screen, the pin floats at the
 * top right. On a phone, this is a row above the title, with undo and redo next
 * to the pin, and the toolbar of the note under it (`children`).
 */
export function EditorTopBar({
  pinned,
  onPinToggle,
  onBack,
  disabled,
  history,
  children,
}: {
  pinned: boolean;
  onPinToggle: () => void;
  onBack: () => void;
  disabled: boolean | undefined;
  history: ComponentChildren;
  children: ComponentChildren;
}) {
  const pinLabel = pinned ? t("noteCard.unpin") : t("noteCard.pin");
  return (
    <div class="note-sheet-top">
      <div class="max-sm:flex max-sm:items-center max-sm:justify-between max-sm:px-2.5">
        <div class="sm:hidden">
          <button
            type="button"
            class={editorButtonClass}
            onClick={onBack}
            aria-label={t("editor.back")}
          >
            <ArrowLeft class="w-5 h-5 max-sm:w-6 max-sm:h-6" />
          </button>
        </div>
        <div class="sm:absolute sm:top-2 sm:right-2 flex items-center gap-0.5">
          {history}
          <Tooltip label={pinLabel}>
            <button
              type="button"
              class={`${editorButtonClass} transition-opacity`}
              onClick={onPinToggle}
              aria-label={pinLabel}
              disabled={disabled}
            >
              {pinned ? (
                <PinOff class={editorIconClass} />
              ) : (
                <Pin class={editorIconClass} />
              )}
            </button>
          </Tooltip>
        </div>
      </div>
      {children}
    </div>
  );
}

/** The tags of the note, each with its remove button, and its reminder. */
export function EditorChips({
  tags,
  onRemoveTag,
  reminder,
  onReminderChange,
}: {
  tags: string[];
  onRemoveTag: (tag: string) => void;
  reminder: NoteReminder | null | undefined;
  onReminderChange: ((reminder: NoteReminder | null) => void) | undefined;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const picker = usePresence(pickerOpen || null, CARD_POPOVER_EXIT_MS);
  const chipRef = useRef<HTMLButtonElement>(null);
  if (tags.length === 0 && !reminder) return null;
  return (
    <div class="flex flex-wrap gap-1 mt-2 items-center">
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag}>
          <button
            type="button"
            class="hover:text-red-500 cursor-pointer"
            onClick={() => onRemoveTag(tag)}
            aria-label={t("editor.removeTag", { tag })}
          >
            ×
          </button>
        </TagChip>
      ))}
      {reminder && (
        <span class="relative">
          <ReminderChip
            reminder={reminder}
            anchorRef={chipRef}
            onClick={() => setPickerOpen(!pickerOpen)}
            expanded={pickerOpen}
            onClear={
              onReminderChange ? () => onReminderChange(null) : undefined
            }
            onDone={
              onReminderChange
                ? () => onReminderChange(reminderDone(reminder))
                : undefined
            }
          />
          {picker.shown && onReminderChange && (
            <CardPopover
              anchorRef={chipRef}
              onClose={() => setPickerOpen(false)}
              leaving={picker.leaving}
            >
              <div class="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 w-72">
                <ReminderPickerPanel
                  reminder={reminder}
                  onChange={onReminderChange}
                  onDone={() => setPickerOpen(false)}
                />
              </div>
            </CardPopover>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * The notice while a header image waits for a click in the text. It also offers
 * the caret, for the keyboard.
 */
export function PlaceImageNotice({
  onAtCaret,
  onCancel,
}: {
  onAtCaret: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="status" class="flex flex-wrap items-center gap-2 mb-2 text-sm">
      <span>{t("editor.placeImageHint")}</span>
      <button
        type="button"
        class={buttonClass("secondary", "xs")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onAtCaret}
      >
        {t("editor.placeImageAtCaret")}
      </button>
      <button
        type="button"
        class={buttonClass("quiet", "xs")}
        onClick={onCancel}
      >
        {t("editor.placeImageCancel")}
      </button>
    </div>
  );
}
