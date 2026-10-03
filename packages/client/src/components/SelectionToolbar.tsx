import type { NoteColor } from "@manifesto/shared";
import {
  Archive,
  CheckSquare,
  Palette,
  Pin,
  Tag,
  Trash2,
  Undo2,
  X,
} from "lucide-preact";
import { useRef, useState } from "preact/hooks";
import { getColorPickerColors, plural, t } from "../i18n/index.js";
import { askConfirmation } from "../state/confirm.js";
import {
  activeView,
  bulkArchive,
  bulkDelete,
  bulkPin,
  bulkRestore,
  bulkSetColor,
  bulkSetTag,
  bulkTrash,
  exitSelectMode,
  notes,
  selectAllVisible,
  selectedNotes,
  sortedNotes,
} from "../state/index.js";
import { Dropdown } from "./Dropdown.js";
import { SelectionTagPicker, tagPickerPanelClass } from "./TagPicker.js";
import { Tooltip } from "./Tooltip.js";

const selToolbarBtnClass = "p-2 rounded-lg hover:bg-white/10 transition-colors";

/** How long the selection bar takes to fade out; `selection-bar-out` in CSS. */
export const SELECTION_BAR_LEAVE_MS = 180;

/** The bar laid over the header while notes are selected: what can be done to
 * all of them at once. */
export function SelectionToolbar({ leaving }: { leaving: boolean }) {
  // Leaving select mode empties the selection in the same step, so the count
  // is held at what it was while the bar fades rather than reading "0".
  const liveCount = selectedNotes.value.size;
  const heldCount = useRef(liveCount);
  if (!leaving) heldCount.current = liveCount;
  const count = heldCount.current;
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const colors = getColorPickerColors();
  const selected = notes.value.filter((n) => selectedNotes.value.has(n.id));
  // The colour to mark in the picker: the one every selected note has, if any.
  const [first] = selected;
  const sharedColor =
    first && selected.every((n) => n.color === first.color)
      ? first.color
      : null;
  const isTrashView = activeView.value === "trash";
  const visibleIds = sortedNotes.value.map((n) => n.id);
  const allSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selectedNotes.value.has(id));

  // A bulk deletion asks whatever the Confirm Deletions preference says. The
  // preference is about the cost of being asked on a single note; nothing here
  // acts on fewer than the whole selection, and a selection is easy to grow by
  // one card without noticing.
  const askThenDelete = async (
    key: "bulkTrash" | "bulkDelete",
    run: () => void,
  ) => {
    const ok = await askConfirmation({
      title: plural(`confirm.${key}.title`, count),
      body: t(`confirm.${key}.body`),
      confirmLabel: t(
        key === "bulkTrash" ? "confirm.trash.action" : "confirm.delete.action",
      ),
    });
    if (ok) run();
  };

  return (
    <div
      class={`selection-bar absolute inset-0 z-30 shadow-md flex items-center border-b border-neutral-200 dark:border-neutral-700 px-2 sm:px-4 pt-[env(safe-area-inset-top)] bg-blue-600 dark:bg-blue-700 text-white${leaving ? " pointer-events-none" : ""}`}
      data-leaving={leaving ? "true" : undefined}
    >
      <div class="flex items-center gap-2 shrink-0">
        <button
          type="button"
          class="p-2 rounded-lg hover:bg-white/10"
          onClick={() => exitSelectMode()}
          aria-label={t("selection.cancel")}
        >
          <X class="w-5 h-5" />
        </button>
        <span class="text-sm font-medium select-none">
          {plural("selection.count", count)}
        </span>
        <Tooltip
          label={
            allSelected ? t("selection.deselectAll") : t("selection.selectAll")
          }
        >
          <button
            type="button"
            class={selToolbarBtnClass}
            onClick={() => selectAllVisible()}
            aria-label={
              allSelected
                ? t("selection.deselectAll")
                : t("selection.selectAll")
            }
            aria-pressed={allSelected}
          >
            <CheckSquare class="w-5 h-5" />
          </button>
        </Tooltip>
      </div>

      <div class="flex-1" />

      <div class="flex items-center gap-0.5 shrink-0">
        {isTrashView ? (
          <>
            <Tooltip label={t("selection.restore")}>
              <button
                type="button"
                class={selToolbarBtnClass}
                onClick={() => bulkRestore()}
                aria-label={t("selection.restoreSelected")}
              >
                <Undo2 class="w-5 h-5" />
              </button>
            </Tooltip>

            <Tooltip label={t("selection.deletePermanently")}>
              <button
                type="button"
                class={selToolbarBtnClass}
                onClick={() => askThenDelete("bulkDelete", bulkDelete)}
                aria-label={t("selection.deleteSelectedPermanently")}
              >
                <Trash2 class="w-5 h-5" />
              </button>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip label={t("selection.pin")}>
              <button
                type="button"
                class={selToolbarBtnClass}
                onClick={() => bulkPin()}
                aria-label={t("selection.pinSelected")}
              >
                <Pin class="w-5 h-5" />
              </button>
            </Tooltip>

            <Dropdown
              open={showTagPicker}
              onClose={() => setShowTagPicker(false)}
              trigger={
                <Tooltip label={t("selection.tags")}>
                  <button
                    type="button"
                    class={selToolbarBtnClass}
                    onClick={() => {
                      setShowTagPicker(!showTagPicker);
                      setShowColorPicker(false);
                    }}
                    aria-label={t("selection.tagSelected")}
                  >
                    <Tag class="w-5 h-5" />
                  </button>
                </Tooltip>
              }
              placement="bottom-end"
              panelClass={tagPickerPanelClass}
            >
              {/* Mounted only while open, so the field is empty and focused each time. */}
              {showTagPicker && (
                <SelectionTagPicker
                  selected={selected}
                  onSetTag={(tag, on) => void bulkSetTag(tag, on)}
                />
              )}
            </Dropdown>

            <Tooltip label={t("selection.archive")}>
              <button
                type="button"
                class={selToolbarBtnClass}
                onClick={() => bulkArchive()}
                aria-label={t("selection.archiveSelected")}
              >
                <Archive class="w-5 h-5" />
              </button>
            </Tooltip>

            <Dropdown
              open={showColorPicker}
              onClose={() => setShowColorPicker(false)}
              trigger={
                <Tooltip label={t("selection.color")}>
                  <button
                    type="button"
                    class={selToolbarBtnClass}
                    onClick={() => {
                      setShowColorPicker(!showColorPicker);
                      setShowTagPicker(false);
                    }}
                    aria-label={t("selection.changeColor")}
                  >
                    <Palette class="w-5 h-5" />
                  </button>
                </Tooltip>
              }
              placement="bottom-end"
              panelClass="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1"
            >
              {colors.map((c) => (
                <Tooltip key={c.value} label={c.label}>
                  <button
                    type="button"
                    class={`w-7 h-7 rounded-full cursor-pointer ${c.swatch} ${sharedColor === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
                    onClick={() => {
                      void bulkSetColor(c.value as NoteColor);
                      setShowColorPicker(false);
                    }}
                    aria-label={c.label}
                  />
                </Tooltip>
              ))}
            </Dropdown>

            <Tooltip label={t("selection.delete")}>
              <button
                type="button"
                class={selToolbarBtnClass}
                onClick={() => askThenDelete("bulkTrash", bulkTrash)}
                aria-label={t("selection.deleteSelected")}
              >
                <Trash2 class="w-5 h-5" />
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
