import { NoteColor, NoteFont } from "@manifesto/shared";
import { ImagePlus } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { noteFontFamilies } from "#/colors.ts";
import { Dropdown } from "#/components/Dropdown.tsx";
import { StoredImage } from "#/components/StoredImage.tsx";
import { Tooltip } from "#/components/Tooltip.tsx";
import { getColorPickerColors, getFontLabel, t } from "#/i18n/index.ts";
import {
  type FormattingTarget,
  keepFocus,
  toolbarButtonClass,
} from "./FormattingMenus.tsx";
import { FontButton } from "./NoteEditorToolbar.tsx";

/**
 * The panel of the color and font pickers of the note (`NoteEditorToolbar`).
 * The text menus show the same choices in the same form.
 */
const pickerPanelClass =
  "p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1";

/**
 * A toolbar button that opens a menu, and the menu. The button is an icon
 * only, as the other buttons of the toolbar are.
 */
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
            class={toolbarButtonClass(active || open)}
            onMouseDown={keepFocus}
            onClick={() => setOpen(!open)}
            aria-label={label}
            disabled={target.disabled}
          >
            {icon}
          </button>
        </Tooltip>
      }
      panelClass={panelClass}
    >
      {children(() => setOpen(false))}
    </Dropdown>
  );
}

/**
 * An "A" over a bar in the color of the selected text. The bar of the default
 * color is the color of the text of the note. There is no bar when the
 * selected text has more than one color. The bar gets its color from
 * `styles/text-spans.css`, as the text does.
 */
function TextColorIcon({ color }: { color: string | false | null }) {
  return (
    <svg
      viewBox="0 0 24 24"
      class="w-4 h-4"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m6 16 6-12 6 12" />
      <path d="M8 12h8" />
      {color !== null && (
        <rect
          x="3"
          y="19"
          width="18"
          height="4"
          rx="1"
          fill="currentColor"
          stroke="none"
          data-color={color || undefined}
        />
      )}
    </svg>
  );
}

/**
 * The color of the selected text, from the colors of a note. The button shows
 * the color of the selected text (`TextColorIcon`).
 */
export function TextColorMenu({
  target,
  current,
}: {
  target: FormattingTarget;
  current: string | false | null;
}) {
  const selected = current === null ? null : current || NoteColor.Default;
  return (
    <ToolbarMenu
      target={target}
      label={t("format.textColor")}
      icon={<TextColorIcon color={current} />}
      active={false}
      panelClass={pickerPanelClass}
    >
      {(close) =>
        getColorPickerColors().map((c) => (
          <Tooltip key={c.value} label={c.label}>
            <button
              type="button"
              class={`w-6 h-6 rounded-full cursor-pointer ${c.swatch} ${selected === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
              aria-label={c.label}
              aria-pressed={selected === c.value}
              onMouseDown={keepFocus}
              onClick={() => {
                target.onFormat("textColor", c.value);
                close();
              }}
            />
          </Tooltip>
        ))
      }
    </ToolbarMenu>
  );
}

/**
 * The font of the selected text, from the fonts of a note. The button shows
 * "Aa" in the font of the selected text, and is empty when the selected text
 * has more than one font.
 */
export function TextFontMenu({
  target,
  current,
}: {
  target: FormattingTarget;
  current: string | false | null;
}) {
  const selected =
    current === null ? null : ((current || NoteFont.Default) as NoteFont);
  return (
    <ToolbarMenu
      target={target}
      label={t("format.textFont")}
      icon={
        <span
          class="flex items-center justify-center w-4 h-4 text-xs leading-none whitespace-nowrap"
          style={{
            fontFamily: (selected && noteFontFamilies[selected]) || undefined,
          }}
          aria-hidden="true"
        >
          {selected && "Aa"}
        </span>
      }
      active={false}
      panelClass={pickerPanelClass}
    >
      {(close) =>
        Object.values(NoteFont).map((font) => (
          <Tooltip key={font} label={getFontLabel(font)}>
            <FontButton
              font={font}
              selected={selected === font}
              onMouseDown={keepFocus}
              onClick={() => {
                target.onFormat("textFont", font);
                close();
              }}
              pressed
            />
          </Tooltip>
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
      panelClass="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 grid grid-cols-4 gap-1"
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
