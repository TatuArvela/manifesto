import type { ActiveFormats, FormatType, TextEdit } from "./formatTypes.ts";
import {
  inRawCodeBlock,
  insertRawBlock,
  toggleRawCodeBlock,
} from "./rawBlockFormatting.ts";
import {
  type InlineFormat,
  inlineRange,
  toggleInline,
  wrappedBy,
} from "./rawInlineFormatting.ts";
import {
  headingLevel,
  isBullet,
  isOrdered,
  lineRange,
  parseLine,
  toggleBlock,
} from "./rawLineFormatting.ts";
import { shiftListItems } from "./rawListIndent.ts";

export type { TextEdit } from "./formatTypes.ts";

/**
 * The formatting toolbar in raw mode.
 *
 * Raw mode edits the Markdown of the note in a textarea, while the rich editor
 * is hidden next to it, and is built again from the text of the textarea on the
 * way back. The toolbar must not talk to that hidden editor, whose document the
 * code will soon discard. Thus, here the same buttons are edits to the Markdown
 * itself. What the toolbar reports and what it changes are both the text that
 * the user sees.
 *
 * All code other than {@link applyTextEdit} is only string operations (the
 * inline formats in `rawInlineFormatting.ts`, the line formats in
 * `rawLineFormatting.ts`, whole blocks in `rawBlockFormatting.ts`). Thus, it is
 * tested in the Node project.
 */

// --- Links ---

const LINK_RE = /\[([^\]\n]*)\]\((<[^>\n]*>|[^)\s]*)\)/g;

/** The `[text](url)` inside which the selection is, if any. */
function enclosingLink(
  value: string,
  start: number,
  end: number,
): { from: number; to: number; text: string } | null {
  const [lineFrom, lineTo] = lineRange(value, start, start);
  const line = value.slice(lineFrom, lineTo);
  for (const m of line.matchAll(LINK_RE)) {
    const from = lineFrom + (m.index ?? 0);
    const to = from + m[0].length;
    // A caret on one of the outer edges is next to the link, not in it.
    const inside =
      start === end ? start > from && start < to : start >= from && end <= to;
    if (inside) return { from, to, text: m[1] ?? "" };
  }
  return null;
}

/** Wraps the selection (or the word at the cursor) as a link to `url`. */
export function applyRawLink(
  value: string,
  start: number,
  end: number,
  url: string,
): TextEdit {
  const [from, to] = inlineRange(value, start, end);
  const text = value.slice(from, to) || url;
  const target = /[\s()<>]/.test(url) ? `<${url}>` : url;
  const link = `[${text}](${target})`;
  const caret = from + link.length;
  return {
    value: value.slice(0, from) + link + value.slice(to),
    selectionStart: caret,
    selectionEnd: caret,
  };
}

/** Unwraps the link around the selection, and keeps its text. */
export function removeRawLink(
  value: string,
  start: number,
  end: number,
): TextEdit | null {
  const link = enclosingLink(value, start, end);
  if (!link) return null;
  return {
    value: value.slice(0, link.from) + link.text + value.slice(link.to),
    selectionStart: link.from,
    selectionEnd: link.from + link.text.length,
  };
}

// --- Clearing ---

/** A private-use character, which no markup of a note contains. */
const CARET = "\uE000";
const TAG_RE = /<\/?(?:u|sub|sup)>/g;
// A sequence of markers that opens a span: at the start of a line or after a
// space or bracket, and before text. A `* ` bullet has a space after it. Thus,
// it stays.
const OPENING_RE = /(^|[\s([{])[*_~`]+(?=[^\s*_~`])/gm;
// A sequence that closes a span: after text, and before the end of a line, a
// space or punctuation. An underscore inside `snake_case` is neither.
const CLOSING_RE = /([^\s*_~`])[*_~`]+(?=$|[\s)\]}.,;:!?])/gm;
const HEADING_RE =
  /^([ \t]*(?:> ?)*(?:(?:[-*+]|\d+[.)]) +)?(?:\[[ xX]\] )?)#{1,6}(?: +|$)/gm;

/**
 * Removes the marks from the selection, or from the line of the caret, and
 * changes a heading back to text, as Clear formatting of the rich editor does.
 * Links stay, because their target is part of the text.
 */
function clearRawFormatting(
  value: string,
  start: number,
  end: number,
): TextEdit {
  const [from, to] =
    start === end ? lineRange(value, start, end) : [start, end];
  const lineStart = start === end || from === 0 || value[from - 1] === "\n";
  // The caret goes through the cleanup as a character of its own. Thus, it
  // stays on the letter next to it, however much markup goes before it.
  let text =
    start === end
      ? value.slice(from, start) + CARET + value.slice(start, to)
      : value.slice(from, to);
  text = text.replace(TAG_RE, "");
  text = text.replace(OPENING_RE, "$1").replace(CLOSING_RE, "$1");
  if (lineStart) text = text.replace(HEADING_RE, "$1");
  const at = from + Math.max(0, text.indexOf(CARET));
  text = text.replace(CARET, "");
  const next = value.slice(0, from) + text + value.slice(to);
  if (start !== end) {
    return {
      value: next,
      selectionStart: from,
      selectionEnd: from + text.length,
    };
  }
  return { value: next, selectionStart: at, selectionEnd: at };
}

// --- Public API ---

/** An empty table, of the size that the rich editor makes. */
const RAW_TABLE = [
  "|   |   |   |",
  "| - | - | - |",
  "|   |   |   |",
  "|   |   |   |",
].join("\n");

export function applyRawFormat(
  value: string,
  start: number,
  end: number,
  type: FormatType,
  arg?: string,
): TextEdit | null {
  switch (type) {
    case "link":
      return null;
    case "bold":
    case "italic":
    case "code":
    case "strikethrough":
    case "underline":
    case "subscript":
    case "superscript":
      return toggleInline(value, start, end, type);
    case "divider":
      return insertRawBlock(value, start, end, "---", "---".length + 2);
    case "table":
      // The caret goes into the first header cell.
      return insertRawBlock(value, start, end, RAW_TABLE, 2);
    case "codeBlock":
      return toggleRawCodeBlock(value, start, end);
    case "indent":
      return shiftListItems(value, start, end, 1);
    case "outdent":
      return shiftListItems(value, start, end, -1);
    case "clearFormatting":
      return clearRawFormatting(value, start, end);
    default:
      return toggleBlock(value, start, end, type, arg);
  }
}

export function getRawActiveFormats(
  value: string,
  start: number,
  end: number,
): ActiveFormats {
  const [lineFrom, lineTo] = lineRange(value, start, start);
  const line = parseLine(value.slice(lineFrom, lineTo));
  const [from, to] = inlineRange(value, start, end);
  const inline = (format: InlineFormat) => !!wrappedBy(value, from, to, format);
  return {
    heading: headingLevel(line) || false,
    bold: inline("bold"),
    italic: inline("italic"),
    quote: line.quote !== "",
    code: inline("code"),
    link: !!enclosingLink(value, start, end),
    numberedList: isOrdered(line),
    unorderedList: isBullet(line) && line.box === "",
    checklist: line.box !== "",
    strikethrough: inline("strikethrough"),
    underline: inline("underline"),
    subscript: inline("subscript"),
    superscript: inline("superscript"),
    // The table button is a menu of row and column changes while it shows as
    // on, and only the rich editor has those. In the text, a row is a line to
    // type.
    table: false,
    codeBlock: inRawCodeBlock(value, start),
  };
}

/**
 * Writes `edit` into the textarea as a single change to its native undo
 * history. Thus, Cmd+Z undoes a toolbar press as it undoes typing.
 *
 * Only the span that is different is replaced. `insertText` over the full value
 * would also work, but would scroll the textarea to the far end of the caret,
 * and would make the undo step a full replacement. `execCommand` is deprecated
 * only in name for this. It is still the one way to edit a text field that the
 * undo stack of the browser records. Where it refuses, the code sets the value
 * directly and sends an `input` event. Thus, the owner still learns of it.
 */
export function applyTextEdit(textarea: HTMLTextAreaElement, edit: TextEdit) {
  const old = textarea.value;
  const next = edit.value;
  let prefix = 0;
  const max = Math.min(old.length, next.length);
  while (prefix < max && old[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    old[old.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  const insert = next.slice(prefix, next.length - suffix);

  textarea.focus();
  if (old !== next) {
    textarea.setSelectionRange(prefix, old.length - suffix);
    const done = insert
      ? document.execCommand("insertText", false, insert)
      : document.execCommand("delete");
    if (!done || textarea.value !== next) {
      textarea.value = next;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
}
