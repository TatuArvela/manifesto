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
import { useState } from "preact/hooks";
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

const inlineMarkers: Record<string, { prefix: string; suffix: string }> = {
  bold: { prefix: "**", suffix: "**" },
  italic: { prefix: "*", suffix: "*" },
  code: { prefix: "`", suffix: "`" },
  strikethrough: { prefix: "~~", suffix: "~~" },
  underline: { prefix: "<u>", suffix: "</u>" },
  subscript: { prefix: "<sub>", suffix: "</sub>" },
  superscript: { prefix: "<sup>", suffix: "</sup>" },
};

const linePrefixes: Record<string, string> = {
  quote: "> ",
  numberedList: "1. ",
  unorderedList: "- ",
  checklist: "[ ] ",
};

export function applyFormatting(
  type: FormatType,
  text: string,
  selStart: number,
  selEnd: number,
  arg?: string,
): { text: string; start: number; end: number } {
  // Inline formatting
  if (type in inlineMarkers) {
    const { prefix, suffix } = inlineMarkers[type];

    // Check if inside an existing marker pair — toggle off
    const pair = findSurroundingMarkerPair(
      text,
      selStart,
      selEnd,
      prefix,
      suffix,
    );
    if (pair) {
      const inner = text.slice(pair.openEnd, pair.closeStart);
      const newText =
        text.slice(0, pair.openStart) + inner + text.slice(pair.closeEnd);
      // Adjust cursor: shift by the removed opening marker
      const newStart = Math.max(pair.openStart, selStart - prefix.length);
      const newEnd = Math.max(pair.openStart, selEnd - prefix.length);
      return { text: newText, start: newStart, end: newEnd };
    }

    // Wrap selection
    const selected = text.slice(selStart, selEnd);
    const newText =
      text.slice(0, selStart) + prefix + selected + suffix + text.slice(selEnd);
    return {
      text: newText,
      start: selStart + prefix.length,
      end: selEnd + prefix.length,
    };
  }

  // Link
  if (type === "link") {
    const selected = text.slice(selStart, selEnd);
    const linkText = selected || "link text";
    const insertion = `[${linkText}](url)`;
    const newText = text.slice(0, selStart) + insertion + text.slice(selEnd);
    // Select "url" so the user can type the URL
    const urlStart = selStart + linkText.length + 3; // [linkText](
    const urlEnd = urlStart + 3; // url
    return { text: newText, start: urlStart, end: urlEnd };
  }

  // Heading
  if (type === "heading") {
    const level = Number.parseInt(arg || "1", 10);
    const prefix = `${"#".repeat(level)} `;
    return applyLinePrefix(text, selStart, selEnd, prefix, /^#{1,6}\s/);
  }

  // Line-prefix formatting
  if (type in linePrefixes) {
    const prefix = linePrefixes[type];
    return applyLinePrefix(text, selStart, selEnd, prefix);
  }

  return { text, start: selStart, end: selEnd };
}

function applyLinePrefix(
  text: string,
  selStart: number,
  selEnd: number,
  prefix: string,
  togglePattern?: RegExp,
): { text: string; start: number; end: number } {
  const lines = text.split("\n");
  let charCount = 0;
  let startLine = 0;
  let endLine = 0;

  // Find which lines are covered by the selection
  for (let i = 0; i < lines.length; i++) {
    const lineEnd = charCount + lines[i].length;
    if (charCount <= selStart && selStart <= lineEnd) startLine = i;
    if (charCount <= selEnd && selEnd <= lineEnd) {
      endLine = i;
      break;
    }
    charCount += lines[i].length + 1; // +1 for \n
  }

  // Check if all selected lines already have the prefix — toggle off
  const pattern = togglePattern || new RegExp(`^${escapeRegex(prefix)}`);
  const allHavePrefix = lines
    .slice(startLine, endLine + 1)
    .every((line) => pattern.test(line));

  let offsetDelta = 0;
  let firstLineDelta = 0;

  for (let i = startLine; i <= endLine; i++) {
    if (allHavePrefix) {
      // Remove prefix
      const match = lines[i].match(pattern);
      if (match) {
        const removed = match[0].length;
        lines[i] = lines[i].slice(removed);
        if (i === startLine) firstLineDelta = -removed;
        offsetDelta -= removed;
      }
    } else {
      // Remove any existing matching prefix first (for heading level switching)
      if (togglePattern) {
        const match = lines[i].match(togglePattern);
        if (match) {
          lines[i] = lines[i].slice(match[0].length);
          if (i === startLine) firstLineDelta -= match[0].length;
          offsetDelta -= match[0].length;
        }
      }
      // Add prefix
      lines[i] = prefix + lines[i];
      if (i === startLine) firstLineDelta += prefix.length;
      offsetDelta += prefix.length;
    }
  }

  return {
    text: lines.join("\n"),
    start: Math.max(0, selStart + firstLineDelta),
    end: Math.max(0, selEnd + offsetDelta),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Inline marker pair finder (shared by detection + toggle) ───────

/**
 * Finds a marker pair surrounding the cursor/selection on the current line.
 * Returns absolute positions of the opening and closing markers, or null.
 */
function findSurroundingMarkerPair(
  text: string,
  selStart: number,
  selEnd: number,
  prefix: string,
  suffix: string,
): {
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
} | null {
  // Check 1: immediately wrapped — but skip if single * is part of **
  const bStart = Math.max(0, selStart - prefix.length);
  if (
    text.slice(bStart, selStart) === prefix &&
    text.slice(selEnd, selEnd + suffix.length) === suffix &&
    !isSingleStarInsideDouble(
      text,
      bStart,
      selEnd + suffix.length,
      prefix,
      suffix,
    )
  ) {
    return {
      openStart: bStart,
      openEnd: selStart,
      closeStart: selEnd,
      closeEnd: selEnd + suffix.length,
    };
  }

  // Check 2: cursor/selection inside a marker pair on the same line
  const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
  const lineEndIdx = text.indexOf("\n", selEnd);
  const line = text.slice(
    lineStart,
    lineEndIdx === -1 ? text.length : lineEndIdx,
  );
  const relStart = selStart - lineStart;
  const relEnd = selEnd - lineStart;

  let pos = 0;
  while (pos < line.length) {
    const openIdx = line.indexOf(prefix, pos);
    if (openIdx === -1) break;

    // Disambiguate * vs **: skip if this * is adjacent to another *
    if (prefix === "*" && isAdjacentStar(line, openIdx, prefix.length)) {
      pos = openIdx + 1;
      continue;
    }

    const afterOpen = openIdx + prefix.length;
    const closeIdx = line.indexOf(suffix, afterOpen);
    if (closeIdx === -1) break;

    // Disambiguate closing * vs **
    if (suffix === "*" && isAdjacentStar(line, closeIdx, suffix.length)) {
      pos = closeIdx + 1;
      continue;
    }

    if (relStart >= openIdx && relEnd <= closeIdx + suffix.length) {
      return {
        openStart: lineStart + openIdx,
        openEnd: lineStart + openIdx + prefix.length,
        closeStart: lineStart + closeIdx,
        closeEnd: lineStart + closeIdx + suffix.length,
      };
    }

    pos = closeIdx + suffix.length;
  }

  return null;
}

/** Check if a single `*` at position is actually part of `**` (or `***`). */
function isAdjacentStar(line: string, idx: number, len: number): boolean {
  if (len !== 1) return false;
  return (idx > 0 && line[idx - 1] === "*") || line[idx + 1] === "*";
}

/** For Check 1: reject a single-* match if it's actually part of a ** pair. */
function isSingleStarInsideDouble(
  text: string,
  openStart: number,
  closeEnd: number,
  prefix: string,
  suffix: string,
): boolean {
  if (prefix !== "*" || suffix !== "*") return false;
  // Check if the open * has another * before it, or the close * has another * after it
  return (
    (openStart > 0 && text[openStart - 1] === "*") || text[closeEnd] === "*"
  );
}

export function detectActiveFormats(
  text: string,
  selStart: number,
  selEnd: number,
): ActiveFormats {
  const formats: ActiveFormats = { ...emptyFormats };

  // Line formats — check current line prefix
  const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
  const lineEndIdx = text.indexOf("\n", selStart);
  const line = text.slice(
    lineStart,
    lineEndIdx === -1 ? text.length : lineEndIdx,
  );

  const headingMatch = line.match(/^(#{1,6})\s/);
  if (headingMatch) formats.heading = headingMatch[1].length;
  if (line.startsWith("> ")) formats.quote = true;
  if (/^\d+\.\s/.test(line)) formats.numberedList = true;
  if (/^- (?!\[[ x]\])/.test(line)) formats.unorderedList = true;
  if (/^(?:- )?\[[ x]\]\s/.test(line)) formats.checklist = true;

  // Inline formats
  for (const [type, { prefix, suffix }] of Object.entries(inlineMarkers)) {
    if (findSurroundingMarkerPair(text, selStart, selEnd, prefix, suffix)) {
      (formats as unknown as Record<string, boolean>)[type] = true;
    }
  }

  // Link — check if cursor is inside [text](url) pattern
  const linkPattern = /\[([^\]]*)\]\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop
  while ((match = linkPattern.exec(line)) !== null) {
    const matchStart = lineStart + match.index;
    const matchEnd = matchStart + match[0].length;
    if (selStart >= matchStart && selEnd <= matchEnd) {
      formats.link = true;
      break;
    }
  }

  return formats;
}

// ── Toolbar component ──────────────────────────────────────────────

interface FormattingToolbarProps {
  onFormat: (type: FormatType, arg?: string) => void;
  activeFormats?: ActiveFormats;
  disabled?: boolean;
}

const btnBase =
  "p-1.5 rounded cursor-pointer disabled:opacity-30 disabled:cursor-default";
const btnInactive = `${btnBase} hover:bg-black/5 dark:hover:bg-white/5`;
const btnActive = `${btnBase} bg-black/10 dark:bg-white/15`;

export function FormattingToolbar({
  onFormat,
  activeFormats,
  disabled,
}: FormattingToolbarProps) {
  const [showHeadingMenu, setShowHeadingMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const af = activeFormats ?? emptyFormats;
  const preventFocus = (e: MouseEvent) => e.preventDefault();

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
