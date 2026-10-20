import { type NoteColor, NoteFont, type NoteReminder } from "@manifesto/shared";
import {
  Check,
  Code,
  EllipsisVertical,
  Eye,
  Image as ImageIcon,
  type LucideIcon,
  Palette,
  PenLine,
  Redo,
  Type,
  Undo,
  X,
} from "lucide-preact";
import { useRef, useState } from "preact/hooks";
import { noteFontFamilies } from "#/colors.ts";
import {
  menuDividerClass,
  menuItemClass,
  menuPanelClass,
  NoteMenu,
  type NoteMenuItem,
} from "#/components/card/NoteMenu.tsx";
import { Dropdown } from "#/components/Dropdown.tsx";
import { ReminderPicker } from "#/components/ReminderPicker.tsx";
import { TagPickerButton } from "#/components/TagPicker.tsx";
import { Tooltip } from "#/components/Tooltip.tsx";
import { getColorPickerColors, getFontLabel, t } from "#/i18n/index.ts";
import { editorButtonClass, editorIconClass } from "./editorButtons.ts";

/**
 * The toolbar of the open note: under the note on a wide screen, and in the top
 * bar on a phone (`atTop`), because the keyboard covers the bottom of the
 * screen there, and iOS never moves anything out from under it. Undo and redo
 * are then in the own row of the top bar (`HistoryButtons`), which leaves space
 * in this row for the other tools. There are two groups that wrap as units: the
 * first tools, and all others. When the bar is too narrow for one row, the
 * first group moves. It takes its own row, and the controls for the thumb (the
 * menu, undo, done) stay together.
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
  onDraw,
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
  atTop = false,
}: {
  color: NoteColor;
  onColorChange: (color: NoteColor) => void;
  font: NoteFont;
  onFontChange: (font: NoteFont) => void;
  tags: string[];
  onAddTag: (tag: string) => void;
  reminder?: NoteReminder | null | undefined;
  onReminderChange?: ((reminder: NoteReminder | null) => void) | undefined;
  onFilesSelected: (files: FileList | null) => void;
  /** Opens the drawing pad. Not given where the note cannot have images. */
  onDraw?: (() => void) | undefined;
  rawMode: boolean;
  onToggleRawMode: () => void;
  menuItems: NoteMenuItem[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete?: (() => void) | undefined;
  deleteLabel?: string | undefined;
  onDone: () => void;
  disabled?: boolean | undefined;
  /** In the top bar of a phone, without undo and redo, not under the note. */
  atTop?: boolean;
}) {
  // A maximum of one of the three panels of the bar is open. When one opens,
  // the others close.
  const [open, setOpen] = useState<"color" | "font" | "menu" | null>(null);
  const toggle = (panel: "color" | "font" | "menu") =>
    setOpen(open === panel ? null : panel);
  const close = () => setOpen(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickerColors = getColorPickerColors();

  // Rendered in one of two places, see below. Drawing is next to the picture
  // that it makes. Before, it was in the menu, where nobody who looked for a
  // way to add a picture found it.
  const imageButtons = (
    <>
      <ToolButton
        label={t("editor.addImage")}
        icon={ImageIcon}
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
      />
      {onDraw && (
        <ToolButton
          label={t("editor.draw")}
          icon={PenLine}
          onClick={() => {
            close();
            onDraw();
          }}
          disabled={disabled}
        />
      )}
    </>
  );

  // The font and raw-mode controls for which the bar of the phone has no space,
  // above the own rows of the menu. They go with those rows while a submenu is
  // open.
  const phoneRows = (
    <>
      <div class="sm:hidden px-3 pt-1.5 pb-1 text-xs text-neutral-500 dark:text-neutral-400">
        {t("editor.font")}
      </div>
      <div class="sm:hidden flex gap-1 px-3 pb-2">
        {Object.values(NoteFont).map((f) => (
          <FontButton
            key={f}
            font={f}
            selected={font === f}
            onClick={() => onFontChange(f)}
          />
        ))}
      </div>

      {/* Raw / Normal mode toggle (mobile only) */}
      <button
        type="button"
        class={`sm:hidden ${menuItemClass}`}
        onClick={() => {
          onToggleRawMode();
          close();
        }}
      >
        {rawMode ? <Eye class="w-4 h-4" /> : <Code class="w-4 h-4" />}
        {rawMode ? t("editor.normalMode") : t("editor.rawMode")}
      </button>

      <div class={`sm:hidden ${menuDividerClass}`} />
    </>
  );

  return (
    <div
      class={`${atTop ? "pb-1" : "note-sheet-bottom pt-1.5 sm:pb-2"} px-3 flex flex-wrap items-center gap-0.5`}
    >
      <div class="flex items-center gap-0.5">
        <Dropdown
          open={open === "color"}
          onClose={close}
          trigger={
            <ToolButton
              label={t("editor.color")}
              ariaLabel={t("editor.changeColor")}
              icon={Palette}
              onClick={() => toggle("color")}
            />
          }
          placement="bottom-start"
          panelClass="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1"
        >
          {pickerColors.map((c) => (
            <Tooltip key={c.value} label={c.label}>
              <button
                type="button"
                class={`w-6 h-6 rounded-full cursor-pointer ${c.swatch} ${color === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
                onClick={() => onColorChange(c.value)}
                aria-label={c.label}
                aria-pressed={color === c.value}
              />
            </Tooltip>
          ))}
        </Dropdown>

        {/* Font picker (desktop only; on mobile, fonts live in the kebab menu) */}
        <div class="max-sm:hidden flex">
          <Dropdown
            open={open === "font"}
            onClose={close}
            trigger={
              <ToolButton
                label={t("editor.font")}
                ariaLabel={t("editor.changeFont")}
                icon={Type}
                onClick={() => toggle("font")}
              />
            }
            placement="bottom-start"
            panelClass="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1"
          >
            {Object.values(NoteFont).map((f) => (
              <Tooltip key={f} label={getFontLabel(f)}>
                <FontButton
                  font={f}
                  selected={font === f}
                  onClick={() => onFontChange(f)}
                  pressed
                />
              </Tooltip>
            ))}
          </Dropdown>
        </div>

        {/* The second tool on a phone. A new note has no reminder, so there
            the image buttons take its place. */}
        {onReminderChange ? (
          <ReminderPicker
            reminder={reminder ?? null}
            onChange={onReminderChange}
            triggerClass={editorButtonClass}
            iconClass={editorIconClass}
          />
        ) : (
          imageButtons
        )}
      </div>

      {/* `grow` so that on a row of its own it still spans the bar. It does
          not wrap inside itself, so it only ever moves as a whole. */}
      <div class="grow flex items-center gap-0.5">
        {onReminderChange && imageButtons}
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
          triggerClass={editorButtonClass}
          iconClass={editorIconClass}
        />

        <Dropdown
          open={open === "menu"}
          onClose={close}
          trigger={
            <ToolButton
              label={t("noteMenu.more")}
              ariaLabel={t("noteMenu.moreOptions")}
              icon={EllipsisVertical}
              onClick={() => toggle("menu")}
            />
          }
          placement="bottom-start"
          panelClass={menuPanelClass}
        >
          <NoteMenu
            items={menuItems}
            onClose={close}
            open={open === "menu"}
            before={phoneRows}
          />
        </Dropdown>

        {/* Normal / Raw mode toggle (desktop only; on mobile, lives in the kebab menu) */}
        <div class="max-sm:hidden flex">
          <ToolButton
            label={rawMode ? t("editor.normalMode") : t("editor.rawMode")}
            icon={rawMode ? Eye : Code}
            onClick={onToggleRawMode}
          />
        </div>

        {!atTop && (
          <>
            {/* Centered between the tools and Done on a phone, inline on desktop. */}
            <div class="flex-1 sm:hidden" />

            <HistoryButtons
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={onUndo}
              onRedo={onRedo}
            />
          </>
        )}

        <div class="flex-1" />

        {onDelete && deleteLabel && (
          <ToolButton label={deleteLabel} icon={X} onClick={onDelete} />
        )}

        <ToolButton label={t("editor.done")} icon={Check} onClick={onDone} />
      </div>
    </div>
  );
}

/** Undo and redo, faded while there is nothing to do. */
export function HistoryButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div class="flex items-center gap-0.5">
      <ToolButton
        label={t("editor.undo")}
        icon={Undo}
        onClick={onUndo}
        disabled={!canUndo}
        dimmed={!canUndo}
      />
      <ToolButton
        label={t("editor.redo")}
        icon={Redo}
        onClick={onRedo}
        disabled={!canRedo}
        dimmed={!canRedo}
      />
    </div>
  );
}

/** One of the icon buttons of the bar, named by its tooltip. */
function ToolButton({
  label,
  ariaLabel = label,
  icon: Icon,
  onClick,
  disabled,
  dimmed,
}: {
  label: string;
  /** Where the name of the button says more than its tooltip. */
  ariaLabel?: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean | undefined;
  /** Shown faded, for undo and redo when there is nothing to do. */
  dimmed?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        class={
          dimmed
            ? `${editorButtonClass} opacity-30 cursor-default`
            : editorButtonClass
        }
        onClick={onClick}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <Icon class={editorIconClass} />
      </button>
    </Tooltip>
  );
}

/** A font to select, shown as "Aa" in that font. */
function FontButton({
  font,
  selected,
  onClick,
  pressed,
}: {
  font: NoteFont;
  selected: boolean;
  onClick: () => void;
  /**
   * Marks the current font for a screen reader, in the picker of the wide
   * screen.
   */
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      class={`px-2 py-1 text-sm rounded cursor-pointer ${selected ? "ring-2 ring-blue-500 ring-offset-1" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
      style={{ fontFamily: noteFontFamilies[font] || undefined }}
      onClick={onClick}
      aria-label={getFontLabel(font)}
      aria-pressed={pressed ? selected : undefined}
    >
      Aa
    </button>
  );
}
