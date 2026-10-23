import type { Note } from "@manifesto/shared";
import clsx from "clsx";
import {
  Archive,
  Bell,
  EllipsisVertical,
  Image as ImageIcon,
  Palette,
  PenLine,
  Pin,
  PinOff,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-preact";
import { useRef } from "preact/hooks";
import { plugins } from "#/autoNotes/registry.ts";
import { iconButtonClass } from "#/components/editor/editorButtons.ts";
import { PresenceAvatars } from "#/components/PresenceAvatars.tsx";
import { Tooltip } from "#/components/Tooltip.tsx";
import { t } from "#/i18n/index.ts";
import {
  permanentlyDeleteNote,
  restoreNote,
  togglePin,
} from "#/state/actions.ts";
import { refreshAutoNotes } from "#/state/autoNotes.ts";
import { confirmDeletion } from "#/state/confirm.ts";
import type { CardPopoverKind } from "./NoteCardPopovers.tsx";

/** The round button at the top-left corner of a card that selects it. */
export function CardSelectButton({
  isSelected,
  isSelectMode,
  onClick,
}: {
  isSelected: boolean;
  isSelectMode: boolean;
  onClick: (e: Event) => void;
}) {
  return (
    <div
      class={clsx(
        "note-select absolute -top-2.5 -left-2.5 z-10",
        // Shown by keyboard focus anywhere in the card, and also by hover.
        // These controls are in the tab order in both cases, and a focus ring
        // on something invisible gives nothing to look at.
        isSelectMode || isSelected
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 group-data-popover-open:opacity-100 group-has-[:focus-visible]:opacity-100",
        "transition-opacity duration-200",
      )}
    >
      <button
        type="button"
        class={clsx(
          // Drawn at 20px, 24px to press (WCAG 2.5.8).
          "relative w-5 h-5 rounded-full flex items-center justify-center transition-all shadow-sm after:absolute after:-inset-0.5",
          isSelected
            ? "bg-blue-500 text-white hover:bg-blue-600"
            : "bg-white dark:bg-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white hover:scale-110 border border-neutral-300",
        )}
        onClick={onClick}
        aria-label={isSelected ? t("noteCard.deselect") : t("noteCard.select")}
      >
        {isSelected && (
          <svg
            class="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
    </div>
  );
}

/** The top-right corner of a card: the pin, its state, and who looks at it. */
export function CardStatusBar({
  note,
  isTrashView,
  isSelectMode,
  overlay,
}: {
  note: Note;
  isTrashView: boolean;
  isSelectMode: boolean;
  overlay: boolean;
}) {
  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: event stop container */
    /* biome-ignore lint/a11y/useKeyWithClickEvents: event stop container */
    <div
      class={clsx(
        "absolute top-2 right-2 z-10 flex items-center gap-0.5 transition-[color,opacity,visibility] duration-200",
        // A card whose full face is an image or a link hero has no note color
        // up here to make darker. The picture under it can be any shade. Thus,
        // the icons become white with their own shadow, and do not use the
        // neutral ramp.
        overlay
          ? "text-white [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.7))]"
          : "text-neutral-500 dark:text-neutral-400 group-hover:text-neutral-800 dark:group-hover:text-neutral-200 group-data-popover-open:text-neutral-800 dark:group-data-popover-open:text-neutral-200 group-has-[:focus-visible]:text-neutral-800 dark:group-has-[:focus-visible]:text-neutral-200 touch:text-neutral-800 dark:touch:text-neutral-200",
        // Faded, not switched, in both directions. Visibility is in the
        // transition. Thus, it waits for the fade out, and still hides the
        // buttons from Tab after it completes.
        isSelectMode && "invisible opacity-0",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {!isTrashView && (
        <Tooltip label={note.pinned ? t("noteCard.unpin") : t("noteCard.pin")}>
          <button
            type="button"
            class={`${iconButtonClass} ${note.pinned ? "opacity-100 group/pin" : "opacity-0 group-hover:opacity-100 group-data-popover-open:opacity-100 group-has-[:focus-visible]:opacity-100 touch:opacity-100"} transition-opacity`}
            onClick={() => togglePin(note.id)}
            aria-label={note.pinned ? t("noteCard.unpin") : t("noteCard.pin")}
          >
            {note.pinned ? (
              <span class="relative block w-4 h-4">
                <Pin class="w-4 h-4 absolute inset-0 transition-opacity duration-200 group-hover/pin:opacity-0" />
                <PinOff class="w-4 h-4 absolute inset-0 transition-opacity duration-200 opacity-0 group-hover/pin:opacity-100" />
              </span>
            ) : (
              <Pin class="w-4 h-4" />
            )}
          </button>
        </Tooltip>
      )}
      {note.archived && (
        <Tooltip label={t("noteCard.archived")}>
          <span class="p-1.5">
            <Archive class="w-4 h-4" />
          </span>
        </Tooltip>
      )}
      {note.trashed && (
        <Tooltip label={t("noteCard.trashed")}>
          <span class="p-1.5">
            <Trash2 class="w-4 h-4" />
          </span>
        </Tooltip>
      )}
      <PresenceAvatars noteId={note.id} />
    </div>
  );
}

/**
 * The row of buttons at the bottom of a card, in the order of the editor
 * toolbar: color, font, reminder, pictures, tags and the menu. In the trash:
 * restore and delete.
 */
export function CardActions({
  note,
  isTrashView,
  isSelectMode,
  overlay,
  colorBtnRef,
  fontBtnRef,
  reminderBtnRef,
  tagsBtnRef,
  menuBtnRef,
  openPopover,
  onToggleColorPicker,
  onToggleFontPicker,
  onToggleReminder,
  onToggleTags,
  onToggleMenu,
  onAttach,
  onDraw,
}: {
  note: Note;
  isTrashView: boolean;
  isSelectMode: boolean;
  overlay?: boolean;
  colorBtnRef: preact.Ref<HTMLButtonElement>;
  fontBtnRef: preact.Ref<HTMLButtonElement>;
  reminderBtnRef: preact.Ref<HTMLButtonElement>;
  tagsBtnRef: preact.Ref<HTMLButtonElement>;
  menuBtnRef: preact.Ref<HTMLButtonElement>;
  /** Which panel of the card is open, for the `aria-expanded` of its button. */
  openPopover: CardPopoverKind | null;
  onToggleColorPicker: () => void;
  /** Not given where this reader cannot change the font of the note. */
  onToggleFontPicker?: (() => void) | undefined;
  onToggleReminder: () => void;
  onToggleTags: () => void;
  onToggleMenu: () => void;
  /**
   * Adds the pictures and the drawing buttons, which open the editor with what
   * you selected or drew. Not given where the note cannot have images.
   */
  onAttach?: ((files: File[]) => void) | undefined;
  onDraw?: (() => void) | undefined;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: event stop container */
    /* biome-ignore lint/a11y/useKeyWithClickEvents: event stop container */
    <div
      class={clsx(
        // A narrow card or screen has less room than the buttons. Thus, the row
        // scrolls sideways (with no bar), and does not cut off the last ones.
        "flex items-center gap-1 overflow-x-auto [scrollbar-width:none] *:shrink-0 transition-[opacity,visibility]",
        overlay
          ? "absolute bottom-0 left-0 right-0 px-2.5 py-2 bg-gradient-to-t from-black/60 to-transparent text-white"
          : // The padding keeps the focus ring (4px out) inside the scroll box.
            "mt-auto pt-3 pb-1 -mb-1 pl-1 -ml-2.5 pr-1 -mr-1",
        isSelectMode
          ? "invisible opacity-0"
          : "opacity-0 group-hover:opacity-100 group-data-popover-open:opacity-100 group-has-[:focus-visible]:opacity-100 touch:opacity-100",
      )}
      onClick={(e) => {
        if (e.target !== e.currentTarget) e.stopPropagation();
      }}
    >
      {isTrashView ? (
        <>
          <Tooltip label={t("noteCard.restore")}>
            <button
              type="button"
              class={iconButtonClass}
              onClick={() => restoreNote(note.id)}
              aria-label={t("noteCard.restoreNote")}
            >
              <Undo2 class="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label={t("noteCard.deletePermanently")}>
            <button
              type="button"
              class={iconButtonClass}
              onClick={async () => {
                const ok = await confirmDeletion({
                  title: t("confirm.delete.title"),
                  body: t("confirm.delete.body"),
                  confirmLabel: t("confirm.delete.action"),
                });
                if (ok) void permanentlyDeleteNote(note.id);
              }}
              aria-label={t("noteCard.deletePermanently")}
            >
              <X class="w-4 h-4" />
            </button>
          </Tooltip>
        </>
      ) : (
        <>
          {note.readonly && (
            <>
              <Tooltip
                label={t("autoNotes.generatedBy", {
                  name:
                    plugins.value.find((p) => p.id === note.source?.pluginId)
                      ?.name ??
                    note.source?.pluginId ??
                    "",
                })}
              >
                <span
                  class="p-1.5 opacity-60"
                  role="img"
                  aria-label={t("autoNotes.badge")}
                >
                  <Sparkles class="w-4 h-4" />
                </span>
              </Tooltip>
              <Tooltip label={t("autoNotes.refresh")}>
                <button
                  type="button"
                  class={iconButtonClass}
                  onClick={() => refreshAutoNotes()}
                  aria-label={t("autoNotes.refresh")}
                >
                  <RefreshCw class="w-4 h-4" />
                </button>
              </Tooltip>
            </>
          )}
          <Tooltip label={t("noteCard.color")}>
            <button
              ref={colorBtnRef}
              type="button"
              class={iconButtonClass}
              onClick={onToggleColorPicker}
              aria-label={t("noteCard.changeColor")}
              aria-expanded={openPopover === "color"}
            >
              <Palette class="w-4 h-4" />
            </button>
          </Tooltip>
          {onToggleFontPicker && (
            <Tooltip label={t("editor.font")}>
              <button
                ref={fontBtnRef}
                type="button"
                class={iconButtonClass}
                onClick={onToggleFontPicker}
                aria-label={t("editor.changeFont")}
                aria-expanded={openPopover === "font"}
              >
                <Type class="w-4 h-4" />
              </button>
            </Tooltip>
          )}
          {/* In the editor's order: colour, font, reminder, pictures. */}
          <Tooltip
            label={note.reminder ? t("reminder.edit") : t("reminder.set")}
          >
            <button
              ref={reminderBtnRef}
              type="button"
              class={iconButtonClass}
              onClick={onToggleReminder}
              aria-label={
                note.reminder ? t("reminder.edit") : t("reminder.set")
              }
              aria-expanded={openPopover === "reminder"}
            >
              <Bell class="w-4 h-4" />
            </button>
          </Tooltip>
          {onAttach && (
            <>
              <Tooltip label={t("editor.addImage")}>
                <button
                  type="button"
                  class={iconButtonClass}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={t("editor.addImage")}
                >
                  <ImageIcon class="w-4 h-4" />
                </button>
              </Tooltip>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                class="hidden"
                onChange={(e) => {
                  const input = e.currentTarget;
                  const files = [...(input.files ?? [])].filter((f) =>
                    f.type.startsWith("image/"),
                  );
                  input.value = "";
                  if (files.length > 0) onAttach(files);
                }}
              />
            </>
          )}
          {onDraw && (
            <Tooltip label={t("editor.draw")}>
              <button
                type="button"
                class={iconButtonClass}
                onClick={onDraw}
                aria-label={t("editor.draw")}
              >
                <PenLine class="w-4 h-4" />
              </button>
            </Tooltip>
          )}
          <Tooltip label={t("noteMenu.tags")}>
            <button
              ref={tagsBtnRef}
              type="button"
              class={iconButtonClass}
              onClick={onToggleTags}
              aria-label={t("noteMenu.tags")}
              aria-expanded={openPopover === "tags"}
            >
              <Tag class="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label={t("noteMenu.more")}>
            <button
              ref={menuBtnRef}
              type="button"
              class={iconButtonClass}
              onClick={onToggleMenu}
              aria-label={t("noteMenu.moreOptions")}
              aria-expanded={openPopover === "menu"}
            >
              <EllipsisVertical class="w-4 h-4" />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
