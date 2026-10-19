import type { Editor } from "@milkdown/kit/core";
import {
  Bold,
  ChevronDown,
  ChevronUp,
  Code,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  MoreHorizontal,
  Quote,
  RemoveFormatting,
  SeparatorHorizontal,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Dropdown } from "#/components/Dropdown.tsx";
import { Tooltip } from "#/components/Tooltip.tsx";
import {
  applyFormat,
  emptyFormats,
  getActiveFormats,
} from "#/extensions/richFormatting.ts";
import { t } from "#/i18n/index.ts";
import type { ActiveFormats, FormatType } from "#/utils/formatTypes.ts";
import {
  applyRawFormat,
  applyTextEdit,
  getRawActiveFormats,
} from "#/utils/rawFormatting.ts";
import {
  FormatButton,
  type FormattingTarget,
  HeadingMenu,
  keepFocus,
  LinkMenu,
  TableMenu,
  toolbarButtonClass,
} from "./FormattingMenus.tsx";

interface FormattingToolbarProps {
  editor: Editor;
  /**
   * The raw-mode textarea, while raw mode is on. The rich editor is still
   * mounted then, only hidden, so without this every button would read and
   * change a document the user cannot see; see `utils/rawFormatting.ts`.
   */
  rawTextarea?: HTMLTextAreaElement | null;
  tick: number;
  disabled?: boolean | undefined;
  onAddLink?: (url: string) => void;
}

function Separator() {
  return <div class="w-px h-4 bg-black/10 dark:bg-white/10 mx-0.5" />;
}

export function FormattingToolbar({
  editor,
  rawTextarea,
  tick,
  disabled,
  onAddLink,
}: FormattingToolbarProps) {
  const [showExtras, setShowExtras] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [af, setAf] = useState<ActiveFormats>(emptyFormats);

  useEffect(() => {
    setAf(
      rawTextarea
        ? getRawActiveFormats(
            rawTextarea.value,
            rawTextarea.selectionStart,
            rawTextarea.selectionEnd,
          )
        : getActiveFormats(editor),
    );
  }, [editor, rawTextarea, tick]);

  const onFormat = (type: FormatType, arg?: string) => {
    if (!rawTextarea) {
      applyFormat(editor, type, arg);
      return;
    }
    const edit = applyRawFormat(
      rawTextarea.value,
      rawTextarea.selectionStart,
      rawTextarea.selectionEnd,
      type,
      arg,
    );
    if (edit) applyTextEdit(rawTextarea, edit);
  };
  const target: FormattingTarget = { editor, rawTextarea, disabled, onFormat };

  const isActive = (type: FormatType): boolean => {
    const v = af[type as keyof ActiveFormats];
    return v === true || (typeof v === "number" && v !== 0);
  };

  const fmtBtn = (type: FormatType, label: string, icon: ComponentChildren) => (
    <FormatButton
      label={label}
      icon={icon}
      active={isActive(type)}
      onClick={() => onFormat(type)}
      disabled={disabled}
    />
  );

  // The rarer marks, the whole blocks, indenting and clearing. A wide screen
  // keeps them on a floating bar; a phone puts them in the fold, since a bar
  // as wide as these wraps over the button that opened it there, and a
  // phone has no Escape to put it away with.
  const extras = () => (
    <>
      {fmtBtn(
        "strikethrough",
        t("format.strikethrough"),
        <Strikethrough class="w-4 h-4" />,
      )}
      {fmtBtn(
        "subscript",
        t("format.subscript"),
        <Subscript class="w-4 h-4" />,
      )}
      {fmtBtn(
        "superscript",
        t("format.superscript"),
        <Superscript class="w-4 h-4" />,
      )}
      <Separator />
      {fmtBtn(
        "divider",
        t("format.divider"),
        <SeparatorHorizontal class="w-4 h-4" />,
      )}
      {fmtBtn("quote", t("format.quote"), <Quote class="w-4 h-4" />)}
      {fmtBtn(
        "codeBlock",
        t("format.codeBlock"),
        <SquareCode class="w-4 h-4" />,
      )}
      <TableMenu target={target} inTable={af.table} />
      <Separator />
      {fmtBtn("indent", t("format.indent"), <IndentIncrease class="w-4 h-4" />)}
      {fmtBtn(
        "outdent",
        t("format.outdent"),
        <IndentDecrease class="w-4 h-4" />,
      )}
      {fmtBtn(
        "clearFormatting",
        t("format.clearFormatting"),
        <RemoveFormatting class="w-4 h-4" />,
      )}
    </>
  );

  return (
    <div class="flex flex-wrap items-center gap-0.5 py-0.5 mb-2 border-b border-black/5 dark:border-white/5">
      {/* The secondary controls. On a wide screen this is an ordinary flex item
          and they sit inline, exactly where they have always been. On a phone
          it drops to a full-width line of its own below the row (`order-2`,
          `w-full`) and unfolds: a one-row grid whose track goes from `0fr` to
          `1fr`, which is the one way to animate to a height nobody has
          measured. The inner box clips the overflow while the track is short,
          and turns invisible with it so the buttons it hides are not tab stops
          on the way past. `visibility` holds until the fold has closed,
          because any progress below 100% still counts as visible. */}
      <div
        class={`max-sm:order-2 max-sm:w-full max-sm:grid max-sm:transition-[grid-template-rows] max-sm:duration-200 max-sm:ease-out ${
          expanded ? "max-sm:grid-rows-[1fr]" : "max-sm:grid-rows-[0fr]"
        }`}
      >
        <div
          class={`max-sm:overflow-hidden max-sm:transition-[visibility] max-sm:duration-200 ${
            expanded ? "" : "max-sm:invisible"
          }`}
        >
          <div class="flex flex-wrap items-center gap-0.5 max-sm:pt-1.5 max-sm:pb-0.5">
            <HeadingMenu target={target} active={Boolean(af.heading)} />

            {fmtBtn("bold", t("format.bold"), <Bold class="w-4 h-4" />)}
            {fmtBtn("italic", t("format.italic"), <Italic class="w-4 h-4" />)}
            {fmtBtn(
              "underline",
              t("format.underline"),
              <Underline class="w-4 h-4" />,
            )}
            {fmtBtn("code", t("format.code"), <Code class="w-4 h-4" />)}

            <Separator />

            <LinkMenu target={target} active={af.link} onAddLink={onAddLink} />

            <Separator />

            {fmtBtn(
              "unorderedList",
              t("format.bulletList"),
              <List class="w-4 h-4" />,
            )}
            {fmtBtn(
              "numberedList",
              t("format.numberedList"),
              <ListOrdered class="w-4 h-4" />,
            )}
            {/* The checklist beside the other lists on a wide screen. On a
                phone it stays out of the fold, on the row itself (below), as
                the one format a note is most often started with. */}
            <div class="max-sm:hidden flex">
              {fmtBtn(
                "checklist",
                t("format.checklist"),
                <ListChecks class="w-4 h-4" />,
              )}
            </div>

            <div class="sm:hidden contents">
              <Separator />
              {extras()}
            </div>
          </div>
        </div>
      </div>

      <div class="sm:hidden flex">
        {fmtBtn(
          "checklist",
          t("format.checklist"),
          <ListChecks class="w-4 h-4" />,
        )}
      </div>

      <div class="max-sm:hidden w-px h-4 bg-black/10 dark:bg-white/10 mx-0.5" />

      {/* The rarer marks, the whole blocks, indenting and clearing, on a bar
          of their own: beside the button that opens it, continuing the row,
          or above it and back to its left where there is no room. It stays
          open while it is used, unlike a menu, so a run of changes does not
          mean reopening it for each one; the button that opened it, or
          Escape, puts it away. Wide screens only: a phone has them in the
          fold (`extras`). */}
      <div class="max-sm:hidden flex">
        <Dropdown
          open={showExtras}
          onClose={() => setShowExtras(false)}
          placement="inline-end"
          persistent
          trigger={
            <Tooltip label={t("format.moreFormatting")}>
              <button
                type="button"
                class={toolbarButtonClass(showExtras)}
                onMouseDown={keepFocus}
                onClick={() => setShowExtras(!showExtras)}
                aria-label={t("format.moreFormatting")}
                disabled={disabled}
              >
                <MoreHorizontal class="w-4 h-4" />
              </button>
            </Tooltip>
          }
          panelClass="w-max rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800"
        >
          <div
            role="toolbar"
            aria-label={t("format.moreFormatting")}
            class="flex flex-wrap items-center gap-0.5 p-1"
          >
            {extras()}
          </div>
        </Dropdown>
      </div>

      <Tooltip label={t("format.moreControls")}>
        <button
          type="button"
          class={`sm:hidden ${toolbarButtonClass(expanded)}`}
          onMouseDown={keepFocus}
          onClick={() => setExpanded(!expanded)}
          aria-label={t("format.moreControls")}
          aria-expanded={expanded}
          disabled={disabled}
        >
          {expanded ? (
            <ChevronUp class="w-4 h-4" />
          ) : (
            <ChevronDown class="w-4 h-4" />
          )}
        </button>
      </Tooltip>
    </div>
  );
}
