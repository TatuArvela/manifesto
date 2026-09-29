import { type NoteColor, NoteFont, type NoteReminder } from "@manifesto/shared";
import {
  Check,
  Code,
  EllipsisVertical,
  Eye,
  Image as ImageIcon,
  Palette,
  Redo,
  Type,
  Undo,
  X,
} from "lucide-preact";
import { useRef, useState } from "preact/hooks";
import { noteFontFamilies } from "../colors.js";
import { getColorPickerColors, getFontLabel, t } from "../i18n/index.js";
import { Dropdown } from "./Dropdown.js";
import { editorBtnClass, editorIconClass } from "./editorButtons.js";
import {
  menuDividerClass,
  menuItemClass,
  menuPanelClass,
  NoteMenu,
  type NoteMenuItem,
} from "./NoteMenu.js";
import { ReminderPicker } from "./ReminderPicker.js";
import { TagPickerButton } from "./TagPicker.js";
import { Tooltip } from "./Tooltip.js";

/**
 * The open note's bottom toolbar. Two groups that wrap as units: the first
 * tools, and everything else. When a phone is too narrow for one row, the
 * first group is what gives way, so it moves up a row and the controls a
 * thumb reaches for (the menu, undo, done) keep the bottom one.
 */
export function NoteEditorToolbar({
  color,
  onColorChange,
  font,
  onFontChange,
  tags,
  onAddTag,
  reminder,
  onReminderChange,
  onFilesSelected,
  rawMode,
  onToggleRawMode,
  menuItems,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDelete,
  deleteLabel,
  onDone,
  disabled,
}: {
  color: NoteColor;
  onColorChange: (color: NoteColor) => void;
  font: NoteFont;
  onFontChange: (font: NoteFont) => void;
  tags: string[];
  onAddTag: (tag: string) => void;
  reminder?: NoteReminder | null;
  onReminderChange?: (reminder: NoteReminder | null) => void;
  onFilesSelected: (files: FileList | null) => void;
  rawMode: boolean;
  onToggleRawMode: () => void;
  menuItems: NoteMenuItem[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  onDone: () => void;
  disabled?: boolean;
}) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerColors = getColorPickerColors();

  const closeAllMenus = () => {
    setShowColorPicker(false);
    setShowFontPicker(false);
    setShowMenu(false);
  };

  // Rendered in one of two places, see below.
  const imageButton = (
    <Tooltip label={t("editor.addImage")}>
      <button
        type="button"
        class={editorBtnClass}
        onClick={() => fileInputRef.current?.click()}
        aria-label={t("editor.addImage")}
        disabled={disabled}
      >
        <ImageIcon class={editorIconClass} />
      </button>
    </Tooltip>
  );

  return (
    <div class="note-sheet-bottom px-3 pt-1.5 sm:pb-2 flex flex-wrap items-center gap-0.5">
      <div class="flex items-center gap-0.5">
        <Dropdown
          open={showColorPicker}
          onClose={() => setShowColorPicker(false)}
          trigger={
            <Tooltip label={t("editor.color")}>
              <button
                type="button"
                class={editorBtnClass}
                onClick={() => {
                  setShowColorPicker(!showColorPicker);
                  setShowMenu(false);
                  setShowFontPicker(false);
                }}
                aria-label={t("editor.changeColor")}
              >
                <Palette class={editorIconClass} />
              </button>
            </Tooltip>
          }
          placement="top-start"
          panelClass="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1"
        >
          {pickerColors.map((c) => (
            <Tooltip key={c.value} label={c.label}>
              <button
                type="button"
                class={`w-6 h-6 rounded-full cursor-pointer ${c.swatch} ${color === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
                onClick={() => onColorChange(c.value)}
                aria-label={c.label}
              />
            </Tooltip>
          ))}
        </Dropdown>

        {/* Font picker (desktop only; on mobile, fonts live in the kebab menu) */}
        <div class="max-sm:hidden flex">
          <Dropdown
            open={showFontPicker}
            onClose={() => setShowFontPicker(false)}
            trigger={
              <Tooltip label={t("editor.font")}>
                <button
                  type="button"
                  class={editorBtnClass}
                  onClick={() => {
                    setShowFontPicker(!showFontPicker);
                    setShowColorPicker(false);
                    setShowMenu(false);
                  }}
                  aria-label={t("editor.changeFont")}
                >
                  <Type class={editorIconClass} />
                </button>
              </Tooltip>
            }
            placement="top-start"
            panelClass="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1"
          >
            {Object.values(NoteFont).map((f) => {
              const label = getFontLabel(f);
              return (
                <Tooltip key={f} label={label}>
                  <button
                    type="button"
                    class={`px-2 py-1 text-sm rounded cursor-pointer ${font === f ? "ring-2 ring-blue-500 ring-offset-1" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                    style={{
                      fontFamily: noteFontFamilies[f] || undefined,
                    }}
                    onClick={() => onFontChange(f)}
                    aria-label={label}
                  >
                    Aa
                  </button>
                </Tooltip>
              );
            })}
          </Dropdown>
        </div>

        {/* The second tool on a phone. A new note has no reminder, so there
            the image button takes its place. */}
        {onReminderChange ? (
          <ReminderPicker
            reminder={reminder ?? null}
            onChange={onReminderChange}
            triggerClass={editorBtnClass}
            iconClass={editorIconClass}
          />
        ) : (
          imageButton
        )}
      </div>

      {/* `grow` so that on a row of its own it still spans the bar. It does
          not wrap inside itself, so it only ever moves as a whole. */}
      <div class="grow flex items-center gap-0.5">
        {onReminderChange && imageButton}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            onFilesSelected(input.files);
            input.value = "";
          }}
        />

        <TagPickerButton
          tags={tags}
          onAddTag={onAddTag}
          triggerClass={editorBtnClass}
          iconClass={editorIconClass}
        />

        <Dropdown
          open={showMenu}
          onClose={() => setShowMenu(false)}
          trigger={
            <Tooltip label={t("noteMenu.more")}>
              <button
                type="button"
                class={editorBtnClass}
                onClick={() => {
                  setShowMenu(!showMenu);
                  setShowColorPicker(false);
                  setShowFontPicker(false);
                }}
                aria-label={t("noteMenu.moreOptions")}
              >
                <EllipsisVertical class={editorIconClass} />
              </button>
            </Tooltip>
          }
          placement="top-start"
          panelClass={menuPanelClass}
        >
          <div class="sm:hidden px-3 pt-1.5 pb-1 text-xs text-neutral-500 dark:text-neutral-400">
            {t("editor.font")}
          </div>
          <div class="sm:hidden flex gap-1 px-3 pb-2">
            {Object.values(NoteFont).map((f) => {
              const label = getFontLabel(f);
              return (
                <button
                  key={f}
                  type="button"
                  class={`px-2 py-1 text-sm rounded cursor-pointer ${font === f ? "ring-2 ring-blue-500 ring-offset-1" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                  style={{ fontFamily: noteFontFamilies[f] || undefined }}
                  onClick={() => onFontChange(f)}
                  aria-label={label}
                >
                  Aa
                </button>
              );
            })}
          </div>

          {/* Raw / Normal mode toggle (mobile only) */}
          <button
            type="button"
            class={`sm:hidden ${menuItemClass}`}
            onClick={() => {
              onToggleRawMode();
              closeAllMenus();
            }}
          >
            {rawMode ? <Eye class="w-4 h-4" /> : <Code class="w-4 h-4" />}
            {rawMode ? t("editor.normalMode") : t("editor.rawMode")}
          </button>

          <div class={`sm:hidden ${menuDividerClass}`} />

          <NoteMenu items={menuItems} onClose={() => setShowMenu(false)} />
        </Dropdown>

        {/* Normal / Raw mode toggle (desktop only; on mobile, lives in the kebab menu) */}
        <div class="max-sm:hidden flex">
          <Tooltip
            label={rawMode ? t("editor.normalMode") : t("editor.rawMode")}
          >
            <button
              type="button"
              class={editorBtnClass}
              onClick={onToggleRawMode}
              aria-label={
                rawMode ? t("editor.normalMode") : t("editor.rawMode")
              }
            >
              {rawMode ? (
                <Eye class={editorIconClass} />
              ) : (
                <Code class={editorIconClass} />
              )}
            </button>
          </Tooltip>
        </div>

        {/* Centered between the tools and Done on a phone, inline on desktop. */}
        <div class="flex-1 sm:hidden" />

        <div class="flex items-center gap-0.5">
          <Tooltip label={t("editor.undo")}>
            <button
              type="button"
              class={`${editorBtnClass} ${canUndo ? "" : "opacity-30 cursor-default"}`}
              onClick={onUndo}
              aria-label={t("editor.undo")}
              disabled={!canUndo}
            >
              <Undo class={editorIconClass} />
            </button>
          </Tooltip>
          <Tooltip label={t("editor.redo")}>
            <button
              type="button"
              class={`${editorBtnClass} ${canRedo ? "" : "opacity-30 cursor-default"}`}
              onClick={onRedo}
              aria-label={t("editor.redo")}
              disabled={!canRedo}
            >
              <Redo class={editorIconClass} />
            </button>
          </Tooltip>
        </div>

        <div class="flex-1" />

        {onDelete && deleteLabel && (
          <Tooltip label={deleteLabel}>
            <button
              type="button"
              class={editorBtnClass}
              onClick={onDelete}
              aria-label={deleteLabel}
            >
              <X class={editorIconClass} />
            </button>
          </Tooltip>
        )}

        <Tooltip label={t("editor.done")}>
          <button
            type="button"
            class={editorBtnClass}
            onClick={onDone}
            aria-label={t("editor.done")}
          >
            <Check class={editorIconClass} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
