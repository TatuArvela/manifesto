import { NoteColor, NoteFont } from "@manifesto/shared";
import { ChevronDown, ImagePlus, Palette, Type } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { colorPickerSwatches, noteFontFamilies } from "#/colors.ts";
import { Dropdown } from "#/components/Dropdown.tsx";
import { StoredImage } from "#/components/StoredImage.tsx";
import { Tooltip } from "#/components/Tooltip.tsx";
import { getColorLabel, getFontLabel, t } from "#/i18n/index.ts";
import {
  type FormattingTarget,
  keepFocus,
  toolbarButtonClass,
} from "./FormattingMenus.tsx";

const menuPanelClass =
  "bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700";

const rowClass =
  "flex items-center gap-2 w-full px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer";

/** A toolbar button that opens a menu, and the menu. */
function ToolbarMenu({
  target,
  label,
  icon,
  active,
  panelClass,
  children,
}: {
  target: FormattingTarget;
  label: string;
  icon: ComponentChildren;
  active: boolean;
  panelClass: string;
  children: (close: () => void) => ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <Tooltip label={label}>
          <button
            type="button"
            class={`${toolbarButtonClass(active)} flex items-center gap-0.5`}
            onMouseDown={keepFocus}
            onClick={() => setOpen(!open)}
            aria-label={label}
            disabled={target.disabled}
          >
            {icon}
            <ChevronDown class="w-3 h-3 opacity-50" />
          </button>
        </Tooltip>
      }
      panelClass={`${menuPanelClass} ${panelClass}`}
    >
      {children(() => setOpen(false))}
    </Dropdown>
  );
}

/** The color of the selected text, from the colors of a note. */
export function TextColorMenu({
  target,
  current,
}: {
  target: FormattingTarget;
  current: string | false;
}) {
  return (
    <ToolbarMenu
      target={target}
      label={t("format.textColor")}
      icon={<Palette class="w-4 h-4" />}
      active={current !== false}
      panelClass="p-2 grid grid-cols-6 gap-1"
    >
      {(close) =>
        colorPickerSwatches.map(({ value }) => (
          <Tooltip key={value} label={getColorLabel(value)}>
            <button
              type="button"
              class="relative w-6 h-6 rounded-full flex items-center justify-center cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700 font-semibold"
              aria-label={getColorLabel(value)}
              aria-pressed={(current || NoteColor.Default) === value}
              onMouseDown={keepFocus}
              onClick={() => {
                target.onFormat("textColor", value);
                close();
              }}
            >
              <span data-color={value}>A</span>
            </button>
          </Tooltip>
        ))
      }
    </ToolbarMenu>
  );
}

/** The font of the selected text, from the fonts of a note. */
export function TextFontMenu({
  target,
  current,
}: {
  target: FormattingTarget;
  current: string | false;
}) {
  return (
    <ToolbarMenu
      target={target}
      label={t("format.textFont")}
      icon={<Type class="w-4 h-4" />}
      active={current !== false}
      panelClass="py-1"
    >
      {(close) =>
        Object.values(NoteFont).map((font) => (
          <button
            key={font}
            type="button"
            class={rowClass}
            style={{ fontFamily: noteFontFamilies[font] || undefined }}
            aria-pressed={(current || NoteFont.Default) === font}
            onMouseDown={keepFocus}
            onClick={() => {
              target.onFormat("textFont", font);
              close();
            }}
          >
            {getFontLabel(font)}
          </button>
        ))
      }
    </ToolbarMenu>
  );
}

/**
 * Puts one of the images of the note in the text, at the caret. Only shown
 * when the note has images. See `utils/inlineImages.ts`.
 */
export function InlineImageMenu({
  target,
  images,
  alts,
}: {
  target: FormattingTarget;
  images: readonly string[];
  alts?: readonly string[] | undefined;
}) {
  return (
    <ToolbarMenu
      target={target}
      label={t("format.inlineImage")}
      icon={<ImagePlus class="w-4 h-4" />}
      active={false}
      panelClass="p-2 grid grid-cols-4 gap-1"
    >
      {(close) =>
        images.map((image, i) => {
          const label =
            alts?.[i] || t("format.inlineImageItem", { number: i + 1 });
          return (
            <Tooltip key={image} label={label}>
              <button
                type="button"
                class="w-12 h-12 rounded overflow-hidden cursor-pointer ring-1 ring-black/10 dark:ring-white/10 hover:ring-2"
                aria-label={label}
                onMouseDown={keepFocus}
                onClick={() => {
                  target.onFormat("inlineImage", String(i + 1));
                  close();
                }}
              >
                <StoredImage
                  src={image}
                  alt=""
                  class="w-full h-full object-cover"
                  placeholderClass="block w-full h-full"
                />
              </button>
            </Tooltip>
          );
        })
      }
    </ToolbarMenu>
  );
}
