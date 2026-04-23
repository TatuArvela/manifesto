import { type Editor, editorStateCtx, editorViewCtx } from "@milkdown/kit/core";
import {
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  updateLinkCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import type { MarkType, NodeType } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import { callCommand } from "@milkdown/kit/utils";
import {
  Bold,
  ChevronDown,
  Code,
  Heading,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  MoreHorizontal,
  Quote,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  toggleSubscriptCommand,
  toggleSuperscriptCommand,
  toggleUnderlineCommand,
} from "../extensions/manifestoInlineMarks.js";
import { t } from "../i18n/index.js";
import { Dropdown } from "./Dropdown.js";
import { Tooltip } from "./Tooltip.js";

export type FormatType =
  | "heading"
  | "bold"
  | "italic"
  | "quote"
  | "code"
  | "link"
  | "numberedList"
  | "unorderedList"
  | "checklist"
  | "strikethrough"
  | "underline"
  | "subscript"
  | "superscript";

export interface ActiveFormats {
  heading: number | false;
  bold: boolean;
  italic: boolean;
  quote: boolean;
  code: boolean;
  link: boolean;
  numberedList: boolean;
  unorderedList: boolean;
  checklist: boolean;
  strikethrough: boolean;
  underline: boolean;
  subscript: boolean;
  superscript: boolean;
}

export const emptyFormats: ActiveFormats = {
  heading: false,
  bold: false,
  italic: false,
  quote: false,
  code: false,
  link: false,
  numberedList: false,
  unorderedList: false,
  checklist: false,
  strikethrough: false,
  underline: false,
  subscript: false,
  superscript: false,
};

function isMarkActive(state: EditorState, mark: MarkType | undefined): boolean {
  if (!mark) return false;
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!mark.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, mark);
}

function findNodeAncestor(
  state: EditorState,
  type: NodeType | undefined,
): { depth: number; attrs: Record<string, unknown> } | null {
  if (!type) return null;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type === type) {
      return { depth, attrs: node.attrs };
    }
  }
  return null;
}

function getActiveFormats(editor: Editor): ActiveFormats {
  return editor.action((ctx) => {
    const state = ctx.get(editorStateCtx);
    const { marks, nodes } = state.schema;

    const headingNode = findNodeAncestor(state, nodes.heading);
    const listItem = findNodeAncestor(state, nodes.list_item);

    return {
      heading: headingNode
        ? (headingNode.attrs.level as number) || false
        : false,
      bold: isMarkActive(state, marks.strong),
      italic: isMarkActive(state, marks.emphasis),
      quote: !!findNodeAncestor(state, nodes.blockquote),
      code: isMarkActive(state, marks.inlineCode),
      link: isMarkActive(state, marks.link),
      numberedList: !!findNodeAncestor(state, nodes.ordered_list),
      unorderedList:
        !!findNodeAncestor(state, nodes.bullet_list) &&
        !(listItem && listItem.attrs.checked != null),
      checklist: !!(listItem && listItem.attrs.checked != null),
      strikethrough: isMarkActive(state, marks.strike_through),
      underline: isMarkActive(state, marks.underline),
      subscript: isMarkActive(state, marks.subscript),
      superscript: isMarkActive(state, marks.superscript),
    };
  });
}

function applyFormat(editor: Editor, type: FormatType, arg?: string): void {
  switch (type) {
    case "bold":
      editor.action(callCommand(toggleStrongCommand.key));
      break;
    case "italic":
      editor.action(callCommand(toggleEmphasisCommand.key));
      break;
    case "code":
      editor.action(callCommand(toggleInlineCodeCommand.key));
      break;
    case "strikethrough":
      editor.action(callCommand(toggleStrikethroughCommand.key));
      break;
    case "heading": {
      const level = Number.parseInt(arg || "1", 10) || 1;
      editor.action(callCommand(wrapInHeadingCommand.key, level));
      break;
    }
    case "quote":
      editor.action(callCommand(wrapInBlockquoteCommand.key));
      break;
    case "numberedList":
      editor.action(callCommand(wrapInOrderedListCommand.key));
      break;
    case "unorderedList":
      editor.action(callCommand(wrapInBulletListCommand.key));
      break;
    case "checklist":
      toggleChecklist(editor);
      break;
    case "underline":
      editor.action(callCommand(toggleUnderlineCommand.key));
      break;
    case "subscript":
      editor.action(callCommand(toggleSubscriptCommand.key));
      break;
    case "superscript":
      editor.action(callCommand(toggleSuperscriptCommand.key));
      break;
  }
}

/**
 * Toggle list items between plain bullets and task items. If not already in
 * a list, wrap first. Then flip `checked` between `null` (plain) and `false`
 * (task, unchecked) on every list item in the selection.
 */
function toggleChecklist(editor: Editor): void {
  const pre = editor.action((ctx) => ctx.get(editorStateCtx));
  const listItemType = pre.schema.nodes.list_item;
  if (!listItemType) return;

  if (!findNodeAncestor(pre, listItemType)) {
    editor.action(callCommand(wrapInBulletListCommand.key));
  }

  editor.action((ctx) => {
    const state = ctx.get(editorStateCtx);
    const view = ctx.get(editorViewCtx);
    const current = findNodeAncestor(state, listItemType);
    const isTaskItem = !!(current && current.attrs.checked != null);

    const { from, to } = state.selection;
    const tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === listItemType) {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          checked: isTaskItem ? null : false,
        });
      }
      return true;
    });
    if (tr.docChanged) view.dispatch(tr);
  });
}

interface FormattingToolbarProps {
  editor: Editor;
  tick: number;
  disabled?: boolean;
  onAddLink?: (url: string) => void;
}

const btnBase =
  "p-1.5 rounded cursor-pointer disabled:opacity-30 disabled:cursor-default";
const btnInactive = `${btnBase} hover:bg-black/5 dark:hover:bg-white/5`;
const btnActive = `${btnBase} bg-black/10 dark:bg-white/15`;

export function FormattingToolbar({
  editor,
  tick,
  disabled,
  onAddLink,
}: FormattingToolbarProps) {
  const [showHeadingMenu, setShowHeadingMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showLinkMenu, setShowLinkMenu] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const [af, setAf] = useState<ActiveFormats>(emptyFormats);

  useEffect(() => {
    setAf(getActiveFormats(editor));
  }, [editor, tick]);

  useEffect(() => {
    if (showLinkMenu) linkInputRef.current?.focus();
  }, [showLinkMenu]);

  const closeLinkMenu = () => {
    setShowLinkMenu(false);
    setLinkUrl("");
  };

  const onLinkClick = () => {
    if (af.link) {
      editor.action(callCommand(toggleLinkCommand.key, {}));
      return;
    }
    setLinkUrl("");
    setShowLinkMenu(true);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (url) {
      editor.action(callCommand(updateLinkCommand.key, { href: url }));
      if (onAddLink && /^https?:\/\//i.test(url)) onAddLink(url);
    }
    closeLinkMenu();
    editor.action((ctx) => ctx.get(editorViewCtx).focus());
  };

  const preventFocus = (e: MouseEvent) => e.preventDefault();
  const onFormat = (type: FormatType, arg?: string) =>
    applyFormat(editor, type, arg);

  const isActive = (type: FormatType): boolean => {
    const v = af[type as keyof ActiveFormats];
    return v === true || (typeof v === "number" && v !== 0);
  };

  const fmtBtn = (
    type: FormatType,
    label: string,
    icon: ComponentChildren,
    arg?: string,
  ) => (
    <Tooltip label={label}>
      <button
        type="button"
        class={isActive(type) ? btnActive : btnInactive}
        onMouseDown={preventFocus}
        onClick={() => onFormat(type, arg)}
        aria-label={label}
        disabled={disabled}
      >
        {icon}
      </button>
    </Tooltip>
  );

  return (
    <div class="flex items-center gap-0.5 py-0.5 mb-2 border-b border-black/5 dark:border-white/5">
      <Dropdown
        open={showHeadingMenu}
        onClose={() => setShowHeadingMenu(false)}
        trigger={
          <Tooltip label={t("format.heading")}>
            <button
              type="button"
              class={`${af.heading ? btnActive : btnInactive} flex items-center gap-0.5`}
              onMouseDown={preventFocus}
              onClick={() => setShowHeadingMenu(!showHeadingMenu)}
              aria-label={t("format.heading")}
              disabled={disabled}
            >
              <Heading class="w-4 h-4" />
              <ChevronDown class="w-3 h-3 opacity-50" />
            </button>
          </Tooltip>
        }
        panelClass="bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 py-1"
      >
        {[1, 2, 3, 4].map((level) => (
          <button
            key={level}
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
            onMouseDown={preventFocus}
            onClick={() => {
              onFormat("heading", String(level));
              setShowHeadingMenu(false);
            }}
          >
            <span class="font-semibold">H{level}</span>
            <span class="text-neutral-400 text-xs">
              {t("format.headingLevel", { level })}
            </span>
          </button>
        ))}
      </Dropdown>

      {fmtBtn("bold", t("format.bold"), <Bold class="w-4 h-4" />)}
      {fmtBtn("italic", t("format.italic"), <Italic class="w-4 h-4" />)}
      {fmtBtn("quote", t("format.quote"), <Quote class="w-4 h-4" />)}
      {fmtBtn("code", t("format.code"), <Code class="w-4 h-4" />)}

      <Dropdown
        open={showLinkMenu}
        onClose={closeLinkMenu}
        trigger={
          <Tooltip label={t("format.link")}>
            <button
              type="button"
              class={af.link ? btnActive : btnInactive}
              onMouseDown={preventFocus}
              onClick={onLinkClick}
              aria-label={t("format.link")}
              disabled={disabled}
            >
              <Link class="w-4 h-4" />
            </button>
          </Tooltip>
        }
        panelClass="bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 p-1.5"
      >
        <form
          class="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            ref={linkInputRef}
            type="url"
            value={linkUrl}
            onInput={(e) => setLinkUrl((e.target as HTMLInputElement).value)}
            placeholder={t("format.linkPlaceholder")}
            class="px-2 py-1 text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded focus:outline-none focus:border-blue-500 w-56"
          />
          <button
            type="submit"
            class="px-2 py-1 text-sm rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
          >
            {t("format.linkAdd")}
          </button>
        </form>
      </Dropdown>

      <div class="w-px h-4 bg-black/10 dark:bg-white/10 mx-0.5" />

      {fmtBtn(
        "numberedList",
        t("format.numberedList"),
        <ListOrdered class="w-4 h-4" />,
      )}
      {fmtBtn(
        "unorderedList",
        t("format.bulletList"),
        <List class="w-4 h-4" />,
      )}
      {fmtBtn(
        "checklist",
        t("format.checklist"),
        <ListChecks class="w-4 h-4" />,
      )}

      <div class="w-px h-4 bg-black/10 dark:bg-white/10 mx-0.5" />

      <Dropdown
        open={showMoreMenu}
        onClose={() => setShowMoreMenu(false)}
        trigger={
          <Tooltip label={t("format.moreFormatting")}>
            <button
              type="button"
              class={btnInactive}
              onMouseDown={preventFocus}
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              aria-label={t("format.moreFormatting")}
              disabled={disabled}
            >
              <MoreHorizontal class="w-4 h-4" />
            </button>
          </Tooltip>
        }
        panelClass="bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 py-1"
      >
        {(
          [
            [
              "strikethrough",
              t("format.strikethrough"),
              <Strikethrough class="w-4 h-4" />,
            ],
            ["underline", t("format.underline"), <Underline class="w-4 h-4" />],
            ["subscript", t("format.subscript"), <Subscript class="w-4 h-4" />],
            [
              "superscript",
              t("format.superscript"),
              <Superscript class="w-4 h-4" />,
            ],
          ] as [FormatType, string, ComponentChildren][]
        ).map(([type, label, icon]) => (
          <button
            key={type}
            type="button"
            class={`flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer ${isActive(type) ? "bg-black/10 dark:bg-white/15" : ""}`}
            onMouseDown={preventFocus}
            onClick={() => {
              onFormat(type);
              setShowMoreMenu(false);
            }}
          >
            {icon}
            {label}
          </button>
        ))}
      </Dropdown>
    </div>
  );
}
