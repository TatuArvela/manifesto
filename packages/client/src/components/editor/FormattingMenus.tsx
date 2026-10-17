import { type Editor, editorStateCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  toggleLinkCommand,
  updateLinkCommand,
} from "@milkdown/kit/preset/commonmark";
import { callCommand } from "@milkdown/kit/utils";
import { ChevronDown, Heading, Link, Table } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  applyTableAction,
  availableTableActions,
  type TableAction,
} from "../../extensions/tableActions.js";
import { t } from "../../i18n/index.js";
import type { FormatType } from "../../utils/formatTypes.js";
import {
  applyRawLink,
  applyTextEdit,
  removeRawLink,
} from "../../utils/rawFormatting.js";
import { Dropdown } from "../Dropdown.js";
import { Tooltip } from "../Tooltip.js";

/** Where the toolbar's changes go, and whether it may make any. */
export interface FormattingTarget {
  editor: Editor;
  /** The raw-mode textarea while raw mode is on; see `FormattingToolbar`. */
  rawTextarea: HTMLTextAreaElement | null | undefined;
  disabled: boolean | undefined;
  onFormat: (type: FormatType, arg?: string) => void;
}

/** A formatting toolbar button, lit while its format applies at the caret. */
export function toolbarButtonClass(active: boolean): string {
  const base =
    "p-1.5 max-sm:p-2.5 rounded cursor-pointer disabled:opacity-30 disabled:cursor-default";
  return active
    ? `${base} bg-black/10 dark:bg-white/15`
    : `${base} hover:bg-black/5 dark:hover:bg-white/5`;
}

/** Keeps the caret where it is when a toolbar button is pressed. */
export const keepFocus = (e: MouseEvent) => e.preventDefault();

const menuPanelClass =
  "bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700";

export function FormatButton({
  label,
  icon,
  active,
  onClick,
  disabled,
  ...aria
}: {
  label: string;
  icon: ComponentChildren;
  active: boolean;
  onClick: () => void;
  disabled: boolean | undefined;
  "aria-haspopup"?: "menu" | undefined;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        class={toolbarButtonClass(active)}
        onMouseDown={keepFocus}
        onClick={onClick}
        aria-label={label}
        disabled={disabled}
        {...aria}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

export function HeadingMenu({
  target,
  active,
}: {
  target: FormattingTarget;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <Tooltip label={t("format.heading")}>
          <button
            type="button"
            class={`${toolbarButtonClass(active)} flex items-center gap-0.5`}
            onMouseDown={keepFocus}
            onClick={() => setOpen(!open)}
            aria-label={t("format.heading")}
            disabled={target.disabled}
          >
            <Heading class="w-4 h-4" />
            <ChevronDown class="w-3 h-3 opacity-50" />
          </button>
        </Tooltip>
      }
      panelClass={`${menuPanelClass} py-1`}
    >
      {[1, 2, 3, 4].map((level) => (
        <button
          key={level}
          type="button"
          class="flex items-center gap-2 w-full px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
          onMouseDown={keepFocus}
          onClick={() => {
            target.onFormat("heading", String(level));
            setOpen(false);
          }}
        >
          <span class="font-semibold">H{level}</span>
          <span class="text-neutral-500 dark:text-neutral-400 text-xs">
            {t("format.headingLevel", { level })}
          </span>
        </button>
      ))}
    </Dropdown>
  );
}

/**
 * The link button: on a link it takes the link off, anywhere else it asks for
 * an address. A web address becomes a preview card too, through `onAddLink`.
 */
export function LinkMenu({
  target,
  active,
  onAddLink,
}: {
  target: FormattingTarget;
  active: boolean;
  onAddLink: ((url: string) => void) | undefined;
}) {
  const { editor, rawTextarea } = target;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setUrl("");
  };

  const onClick = () => {
    if (active) {
      if (rawTextarea) {
        const edit = removeRawLink(
          rawTextarea.value,
          rawTextarea.selectionStart,
          rawTextarea.selectionEnd,
        );
        if (edit) applyTextEdit(rawTextarea, edit);
      } else {
        editor.action(callCommand(toggleLinkCommand.key, {}));
      }
      return;
    }
    setUrl("");
    setOpen(true);
  };

  const apply = () => {
    const href = url.trim();
    if (href) {
      if (rawTextarea) {
        applyTextEdit(
          rawTextarea,
          applyRawLink(
            rawTextarea.value,
            rawTextarea.selectionStart,
            rawTextarea.selectionEnd,
            href,
          ),
        );
      } else {
        editor.action(callCommand(updateLinkCommand.key, { href }));
      }
      if (onAddLink && /^https?:\/\//i.test(href)) onAddLink(href);
    }
    close();
    if (rawTextarea) rawTextarea.focus();
    else editor.action((ctx) => ctx.get(editorViewCtx).focus());
  };

  return (
    <Dropdown
      open={open}
      onClose={close}
      trigger={
        <FormatButton
          label={t("format.link")}
          icon={<Link class="w-4 h-4" />}
          active={active}
          onClick={onClick}
          disabled={target.disabled}
        />
      }
      panelClass={`${menuPanelClass} p-1.5`}
    >
      <form
        class="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <input
          ref={inputRef}
          type="url"
          value={url}
          onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
          placeholder={t("format.linkPlaceholder")}
          class="px-2 py-1 max-sm:py-1.5 text-sm max-sm:text-base bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded focus:outline-none focus:border-blue-500 w-56"
        />
        <button
          type="submit"
          class="px-2 py-1 max-sm:py-1.5 text-sm max-sm:text-base rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
        >
          {t("format.linkAdd")}
        </button>
      </form>
    </Dropdown>
  );
}

/** In a table the button opens the table's menu; anywhere else it makes one. */
export function TableMenu({
  target,
  inTable,
}: {
  target: FormattingTarget;
  inTable: boolean;
}) {
  const { editor, rawTextarea } = target;
  const [actions, setActions] = useState<TableAction[] | null>(null);

  const onClick = () => {
    if (actions) {
      setActions(null);
      return;
    }
    if (rawTextarea || !inTable) {
      target.onFormat("table");
      return;
    }
    setActions(
      editor.action((ctx) => availableTableActions(ctx.get(editorStateCtx))),
    );
  };

  const run = (action: TableAction) => {
    setActions(null);
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      applyTableAction(view.state, action, view.dispatch);
    });
  };

  const labels: Record<TableAction, string> = {
    addRowAfter: t("format.tableAddRow"),
    addColumnAfter: t("format.tableAddColumn"),
    deleteRow: t("format.tableDeleteRow"),
    deleteColumn: t("format.tableDeleteColumn"),
    deleteTable: t("format.tableDelete"),
  };

  return (
    <Dropdown
      open={actions !== null}
      onClose={() => setActions(null)}
      trigger={
        <FormatButton
          label={t("format.table")}
          icon={<Table class="w-4 h-4" />}
          active={inTable}
          onClick={onClick}
          aria-haspopup={inTable && !rawTextarea ? "menu" : undefined}
          disabled={target.disabled}
        />
      }
      panelClass={`${menuPanelClass} py-1`}
    >
      {(actions ?? []).map((action) => (
        <button
          key={action}
          type="button"
          class="flex items-center w-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer whitespace-nowrap"
          onMouseDown={keepFocus}
          onClick={() => run(action)}
        >
          {labels[action]}
        </button>
      ))}
    </Dropdown>
  );
}
