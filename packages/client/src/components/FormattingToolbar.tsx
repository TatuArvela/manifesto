import type { Editor } from "@tiptap/core";
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
import { useEffect, useState } from "preact/hooks";
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

function getActiveFormats(editor: Editor): ActiveFormats {
  return {
    heading: editor.isActive("heading")
      ? (editor.getAttributes("heading").level as number)
      : false,
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    quote: editor.isActive("blockquote"),
    code: editor.isActive("code"),
    link: editor.isActive("link"),
    numberedList: editor.isActive("orderedList"),
    unorderedList: editor.isActive("bulletList"),
    checklist: editor.isActive("taskList"),
    strikethrough: editor.isActive("strike"),
    underline: editor.isActive("underline"),
    subscript: editor.isActive("subscript"),
    superscript: editor.isActive("superscript"),
  };
}

function applyTiptapFormat(
  editor: Editor,
  type: FormatType,
  arg?: string,
): void {
  const chain = editor.chain().focus();

  switch (type) {
    case "bold":
      chain.toggleBold().run();
      break;
    case "italic":
      chain.toggleItalic().run();
      break;
    case "code":
      chain.toggleCode().run();
      break;
    case "strikethrough":
      chain.toggleStrike().run();
      break;
    case "underline":
      chain.toggleUnderline().run();
      break;
    case "subscript":
      chain.toggleSubscript().run();
      break;
    case "superscript":
      chain.toggleSuperscript().run();
      break;
    case "heading": {
      const level = (Number.parseInt(arg || "1", 10) || 1) as 1 | 2 | 3 | 4;
      chain.toggleHeading({ level }).run();
      break;
    }
    case "quote":
      chain.toggleBlockquote().run();
      break;
    case "numberedList":
      chain.toggleOrderedList().run();
      break;
    case "unorderedList":
      chain.toggleBulletList().run();
      break;
    case "checklist":
      chain.toggleTaskList().run();
      break;
    case "link": {
      if (editor.isActive("link")) {
        chain.unsetLink().run();
      } else {
        const url = prompt("Enter URL:");
        if (url) {
          chain.setLink({ href: url }).run();
        }
      }
      break;
    }
  }
}

// ── Toolbar component ──────────────────────────────────────────────

interface FormattingToolbarProps {
  editor: Editor;
  disabled?: boolean;
}

const btnBase =
  "p-1.5 rounded cursor-pointer disabled:opacity-30 disabled:cursor-default";
const btnInactive = `${btnBase} hover:bg-black/5 dark:hover:bg-white/5`;
const btnActive = `${btnBase} bg-black/10 dark:bg-white/15`;

export function FormattingToolbar({
  editor,
  disabled,
}: FormattingToolbarProps) {
  const [showHeadingMenu, setShowHeadingMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // Force re-render on every editor transaction so active format detection stays current
  const [, setTxCount] = useState(0);
  useEffect(() => {
    const handler = () => setTxCount((c) => c + 1);
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);

  const af = getActiveFormats(editor);
  const preventFocus = (e: MouseEvent) => e.preventDefault();
  const onFormat = (type: FormatType, arg?: string) =>
    applyTiptapFormat(editor, type, arg);

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
      {/* Heading dropdown */}
      <Dropdown
        open={showHeadingMenu}
        onClose={() => setShowHeadingMenu(false)}
        trigger={
          <Tooltip label="Heading">
            <button
              type="button"
              class={`${af.heading ? btnActive : btnInactive} flex items-center gap-0.5`}
              onMouseDown={preventFocus}
              onClick={() => setShowHeadingMenu(!showHeadingMenu)}
              aria-label="Heading"
              disabled={disabled}
            >
              <Heading class="w-4 h-4" />
              <ChevronDown class="w-3 h-3 opacity-50" />
            </button>
          </Tooltip>
        }
        panelClass="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-20"
      >
        {[1, 2, 3, 4].map((level) => (
          <button
            key={level}
            type="button"
            class="flex items-center gap-2 w-full px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
            onMouseDown={preventFocus}
            onClick={() => {
              onFormat("heading", String(level));
              setShowHeadingMenu(false);
            }}
          >
            <span class="font-semibold">H{level}</span>
            <span class="text-gray-400 text-xs">Heading {level}</span>
          </button>
        ))}
      </Dropdown>

      {fmtBtn("bold", "Bold", <Bold class="w-4 h-4" />)}
      {fmtBtn("italic", "Italic", <Italic class="w-4 h-4" />)}
      {fmtBtn("quote", "Quote", <Quote class="w-4 h-4" />)}
      {fmtBtn("code", "Code", <Code class="w-4 h-4" />)}
      {fmtBtn("link", "Link", <Link class="w-4 h-4" />)}

      <div class="w-px h-4 bg-black/10 dark:bg-white/10 mx-0.5" />

      {fmtBtn("numberedList", "Numbered list", <ListOrdered class="w-4 h-4" />)}
      {fmtBtn("unorderedList", "Bullet list", <List class="w-4 h-4" />)}
      {fmtBtn("checklist", "Checklist", <ListChecks class="w-4 h-4" />)}

      <div class="w-px h-4 bg-black/10 dark:bg-white/10 mx-0.5" />

      {/* More dropdown */}
      <Dropdown
        open={showMoreMenu}
        onClose={() => setShowMoreMenu(false)}
        trigger={
          <Tooltip label="More formatting">
            <button
              type="button"
              class={btnInactive}
              onMouseDown={preventFocus}
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              aria-label="More formatting"
              disabled={disabled}
            >
              <MoreHorizontal class="w-4 h-4" />
            </button>
          </Tooltip>
        }
        panelClass="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-20"
      >
        <button
          type="button"
          class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          onMouseDown={preventFocus}
          onClick={() => {
            onFormat("strikethrough");
            setShowMoreMenu(false);
          }}
        >
          <Strikethrough class="w-4 h-4" />
          Strikethrough
        </button>
        <button
          type="button"
          class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          onMouseDown={preventFocus}
          onClick={() => {
            onFormat("underline");
            setShowMoreMenu(false);
          }}
        >
          <Underline class="w-4 h-4" />
          Underline
        </button>
        <button
          type="button"
          class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          onMouseDown={preventFocus}
          onClick={() => {
            onFormat("subscript");
            setShowMoreMenu(false);
          }}
        >
          <Subscript class="w-4 h-4" />
          Subscript
        </button>
        <button
          type="button"
          class="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
          onMouseDown={preventFocus}
          onClick={() => {
            onFormat("superscript");
            setShowMoreMenu(false);
          }}
        >
          <Superscript class="w-4 h-4" />
          Superscript
        </button>
      </Dropdown>
    </div>
  );
}
