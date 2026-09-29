import type { ActiveFormats, FormatType, TextEdit } from "./formatTypes.js";
import {
  type InlineFormat,
  inlineRange,
  toggleInline,
  wrappedBy,
} from "./rawInlineFormatting.js";
import {
  headingLevel,
  isBullet,
  isOrdered,
  lineRange,
  parseLine,
  toggleBlock,
} from "./rawLineFormatting.js";

export type { TextEdit } from "./formatTypes.js";

/**
 * The formatting toolbar in raw mode.
 *
 * Raw mode edits the note's markdown in a textarea while the rich editor sits
 * hidden beside it, rebuilt from the textarea's text on the way back. The
 * toolbar must not talk to that hidden editor, whose document is about to be
 * thrown away, so here the same buttons are expressed as edits to the markdown
 * itself: what the toolbar reports and what it changes are both the text the
 * user is looking at.
 *
 * Everything but {@link applyTextEdit} is pure string work (the inline
 * formats in `rawInlineFormatting.ts`, the line ones in
 * `rawLineFormatting.ts`), so it is tested in the Node project.
 */

// --- Links ---

const LINK_RE = /\[([^\]\n]*)\]\((<[^>\n]*>|[^)\s]*)\)/g;

/** The `[text](url)` the selection sits inside, if any. */
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
    // A caret on either outer edge is beside the link, not in it.
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

/** Unwraps the link around the selection, keeping its text. */
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

// --- Public API ---

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
  };
}

/**
 * Writes `edit` into the textarea as a single change to its native undo
 * history, so Cmd+Z takes back a toolbar press the way it takes back typing.
 *
 * Only the span that differs is replaced: `insertText` over the whole value
 * would also work, but would scroll the textarea to the caret's far end and
 * make the undo step a wholesale replacement. `execCommand` is deprecated
 * in name only for this; it is still the one way to edit a text field that
 * the browser's undo stack records. Where it declines, the value is set
 * directly and an `input` event raised so the owner still hears of it.
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
