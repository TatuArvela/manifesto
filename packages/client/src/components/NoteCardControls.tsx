import type { Note } from "@manifesto/shared";
import clsx from "clsx";
import {
  Archive,
  EllipsisVertical,
  Palette,
  Pin,
  PinOff,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  X,
} from "lucide-preact";
import { plugins } from "../autoNotes/registry.js";
import { t } from "../i18n/index.js";
import { refreshAutoNotes } from "../state/autoNotes.js";
import { confirmDeletion } from "../state/confirm.js";
import {
  permanentlyDeleteNote,
  restoreNote,
  togglePin,
} from "../state/index.js";
import { iconBtnClass } from "./editorButtons.js";
import { PresenceAvatars } from "./PresenceAvatars.js";
import { Tooltip } from "./Tooltip.js";

/** The round button at a card's top-left corner that selects it. */
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
        // Revealed by keyboard focus anywhere in the card as well as by
        // hover: these controls are in the tab order either way, and a
        // focus ring on something invisible leaves nothing to look at.
        isSelectMode || isSelected
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100",
        "transition-opacity duration-200",
      )}
    >
      <button
        type="button"
        class={clsx(
          "w-5 h-5 rounded-full flex items-center justify-center transition-all shadow-sm",
          isSelected
            ? "bg-blue-500 text-white hover:bg-blue-600"
            : "bg-white dark:bg-neutral-200 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white hover:scale-110 border border-neutral-300",
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

/** The top-right corner of a card: the pin, what state it is in, and who is
 * looking at it. */
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
        // A card whose whole face is an image or a link hero has no
        // note colour up here to darken against, and the picture
        // underneath can be any shade, so the icons go white with a
        // shadow of their own rather than joining the neutral ramp.
        overlay
          ? "text-white [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.7))]"
          : "text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-neutral-200 group-has-[:focus-visible]:text-neutral-800 dark:group-has-[:focus-visible]:text-neutral-200 touch:text-neutral-800 dark:touch:text-neutral-200",
        // Faded rather than switched, both ways. Visibility is in the
        // transition so it waits for the fade out, and still hides the
        // buttons from Tab once it has finished.
        isSelectMode && "invisible opacity-0",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {!isTrashView && (
        <Tooltip label={note.pinned ? t("noteCard.unpin") : t("noteCard.pin")}>
          <button
            type="button"
            class={`${iconBtnClass} ${note.pinned ? "opacity-100 group/pin" : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 touch:opacity-100"} transition-opacity`}
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
          <span class="p-1.5 opacity-60">
            <Archive class="w-4 h-4" />
          </span>
        </Tooltip>
      )}
      {note.trashed && (
        <Tooltip label={t("noteCard.trashed")}>
          <span class="p-1.5 opacity-60">
            <Trash2 class="w-4 h-4" />
          </span>
        </Tooltip>
      )}
      <PresenceAvatars noteId={note.id} />
    </div>
  );
}

/** The row of buttons along a card's foot: colour, tags and the menu, or
 * restore and delete in the trash. */
export function CardActions({
  note,
  isTrashView,
  isSelectMode,
  overlay,
  colorBtnRef,
  tagsBtnRef,
  menuBtnRef,
  onToggleColorPicker,
  onToggleTags,
  onToggleMenu,
}: {
  note: Note;
  isTrashView: boolean;
  isSelectMode: boolean;
  overlay?: boolean;
  colorBtnRef: preact.Ref<HTMLButtonElement>;
  tagsBtnRef: preact.Ref<HTMLButtonElement>;
  menuBtnRef: preact.Ref<HTMLButtonElement>;
  onToggleColorPicker: () => void;
  onToggleTags: () => void;
  onToggleMenu: () => void;
}) {
  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: event stop container */
    /* biome-ignore lint/a11y/useKeyWithClickEvents: event stop container */
    <div
      class={clsx(
        "flex items-center gap-1 transition-[opacity,visibility]",
        overlay
          ? "absolute bottom-0 left-0 right-0 px-2.5 py-2 bg-gradient-to-t from-black/60 to-transparent text-white"
          : "mt-auto pt-3 -ml-1.5",
        isSelectMode
          ? "invisible opacity-0"
          : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 touch:opacity-100",
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
              class={iconBtnClass}
              onClick={() => restoreNote(note.id)}
              aria-label={t("noteCard.restoreNote")}
            >
              <Undo2 class="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label={t("noteCard.deletePermanently")}>
            <button
              type="button"
              class={iconBtnClass}
              onClick={async () => {
                const ok = await confirmDeletion({
                  title: t("confirm.delete.title"),
                  body: t("confirm.delete.body"),
                  confirmLabel: t("confirm.delete.action"),
                });
                if (ok) permanentlyDeleteNote(note.id);
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
                  class={iconBtnClass}
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
              class={iconBtnClass}
              onClick={onToggleColorPicker}
              aria-label={t("noteCard.changeColor")}
            >
              <Palette class="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label={t("noteMenu.tags")}>
            <button
              ref={tagsBtnRef}
              type="button"
              class={iconBtnClass}
              onClick={onToggleTags}
              aria-label={t("noteMenu.tags")}
            >
              <Tag class="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip label={t("noteMenu.more")}>
            <button
              ref={menuBtnRef}
              type="button"
              class={iconBtnClass}
              onClick={onToggleMenu}
              aria-label={t("noteMenu.moreOptions")}
            >
              <EllipsisVertical class="w-4 h-4" />
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
