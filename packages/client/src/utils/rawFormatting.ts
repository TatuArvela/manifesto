import type {
  ActiveFormats,
  FormatType,
} from "../components/FormattingToolbar.js";

/**
 * The formatting toolbar in raw mode.
 *
 * Raw mode edits the note's markdown in a textarea while the rich editor sits
 * hidden beside it, rebuilt from the textarea's text on the way back. The
 * toolbar used to keep talking to that hidden editor: its buttons lit up for
 * wherever the rich cursor had last been, and pressing one changed a document
 * about to be thrown away. Here the same buttons are expressed as edits to the
 * markdown itself, so what the toolbar reports and what it changes are both the
 * text the user is looking at.
 *
 * Everything but {@link applyTextEdit} is pure string work, so it is tested in
 * the Node project.
 */

export interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

type InlineFormat =
  | "bold"
  | "italic"
  | "code"
  | "strikethrough"
  | "underline"
  | "subscript"
  | "superscript";

const TAGS: Partial<Record<InlineFormat, string>> = {
  underline: "u",
  subscript: "sub",
  superscript: "sup",
};

/** Marker characters and tags peeled off a word before looking at its edges. */
const EDGE_MARKUP_START = /^(?:<(?:u|sub|sup)>|[*_~`])+/;
const EDGE_MARKUP_END = /(?:<\/(?:u|sub|sup)>|[*_~`])+$/;

function runBefore(value: string, pos: number, ch: string): number {
  let n = 0;
  while (pos - n - 1 >= 0 && value[pos - n - 1] === ch) n++;
  return n;
}

function runAfter(value: string, pos: number, ch: string): number {
  let n = 0;
  while (pos + n < value.length && value[pos + n] === ch) n++;
  return n;
}

/**
 * The range an inline format applies to: the selection without surrounding
 * whitespace (`** bold **` is not bold), or with nothing selected, the word
 * under the cursor minus any markup already hugging it, so that pressing Bold
 * inside `**word**` finds the markers to take away rather than nesting more.
 */
function inlineRange(
  value: string,
  start: number,
  end: number,
): [number, number] {
  if (start !== end) {
    while (start < end && /\s/.test(value[start])) start++;
    while (end > start && /\s/.test(value[end - 1])) end--;
    return [start, end];
  }
  let from = start;
  let to = start;
  while (from > 0 && !/\s/.test(value[from - 1])) from--;
  while (to < value.length && !/\s/.test(value[to])) to++;
  if (from === to) return [start, start];
  const word = value.slice(from, to);
  const lead = EDGE_MARKUP_START.exec(word)?.[0].length ?? 0;
  const trail = EDGE_MARKUP_END.exec(word.slice(lead))?.[0].length ?? 0;
  const coreFrom = from + lead;
  const coreTo = to - trail;
  // A cursor sitting in the markup itself, or a word that is all markup, has
  // no text to format: leave the cursor where it is and insert at it.
  if (coreFrom >= coreTo || start < coreFrom || start > coreTo) {
    return [start, start];
  }
  return [coreFrom, coreTo];
}

/**
 * How many marker characters to remove on each side to turn `format` off, or
 * 0 if it is not on. `*` and `_` are read as runs because they share a
 * character between two formats: a run of one is italic, two is bold, three
 * is both.
 */
function wrappedBy(
  value: string,
  from: number,
  to: number,
  format: InlineFormat,
): { open: string; close: string } | null {
  const tag = TAGS[format];
  if (tag) {
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    return value.slice(from - open.length, from) === open &&
      value.slice(to, to + close.length) === close
      ? { open, close }
      : null;
  }
  const chars =
    format === "code" ? ["`"] : format === "strikethrough" ? ["~"] : ["*", "_"];
  for (const ch of chars) {
    const n = Math.min(runBefore(value, from, ch), runAfter(value, to, ch));
    let take = 0;
    if (format === "bold" && n >= 2) take = 2;
    else if (format === "italic" && n % 2 === 1) take = 1;
    else if (format === "strikethrough" && n >= 2) take = 2;
    else if (format === "code" && n >= 1) take = n;
    if (take > 0) {
      const marker = ch.repeat(take);
      return { open: marker, close: marker };
    }
  }
  return null;
}

function inlineMarkers(format: InlineFormat): { open: string; close: string } {
  const tag = TAGS[format];
  if (tag) return { open: `<${tag}>`, close: `</${tag}>` };
  const marker =
    format === "bold"
      ? "**"
      : format === "italic"
        ? "*"
        : format === "strikethrough"
          ? "~~"
          : "`";
  return { open: marker, close: marker };
}

function toggleInline(
  value: string,
  start: number,
  end: number,
  format: InlineFormat,
): TextEdit {
  const [from, to] = inlineRange(value, start, end);
  const existing = wrappedBy(value, from, to, format);
  if (existing) {
    const { open, close } = existing;
    return {
      value:
        value.slice(0, from - open.length) +
        value.slice(from, to) +
        value.slice(to + close.length),
      selectionStart: from - open.length,
      selectionEnd: to - open.length,
    };
  }
  const { open, close } = inlineMarkers(format);
  return {
    value:
      value.slice(0, from) +
      open +
      value.slice(from, to) +
      close +
      value.slice(to),
    selectionStart: from + open.length,
    selectionEnd: to + open.length,
  };
}

// --- Lines ---

/**
 * One line of markdown taken apart as far as the toolbar cares: nesting, a
 * quote, a list marker, a task box, a heading, then the text. Anything the
 * pattern does not recognise stays in `text`, so reassembling an untouched
 * line always gives back exactly what went in.
 */
interface ParsedLine {
  indent: string;
  quote: string;
  marker: string;
  box: string;
  heading: string;
  text: string;
}

const LINE_RE =
  /^(\s*)((?:> ?)*)((?:[-*+]|\d+[.)]) +)?(\[[ xX]\](?: |$))?(#{1,6}(?: +|$))?(.*)$/;

function parseLine(line: string): ParsedLine {
  const m = LINE_RE.exec(line) as RegExpExecArray;
  return {
    indent: m[1],
    quote: m[2],
    marker: m[3] ?? "",
    box: m[4] ?? "",
    heading: m[5] ?? "",
    text: m[6],
  };
}

function joinLine(p: ParsedLine): string {
  return p.indent + p.quote + p.marker + p.box + p.heading + p.text;
}

const isOrdered = (p: ParsedLine) => /^\d/.test(p.marker);
const isBullet = (p: ParsedLine) => p.marker !== "" && !isOrdered(p);
const headingLevel = (p: ParsedLine) => p.heading.trim().length;

/** The whole lines the selection touches, as offsets into `value`. */
function lineRange(
  value: string,
  start: number,
  end: number,
): [number, number] {
  // `lastIndexOf` clamps a negative position to 0 and would then find a
  // newline the caret is before, not after.
  const from = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  // A selection that ends at the very start of a line (a triple-click, or a
  // drag down to the next line) does not include that line.
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nl = value.indexOf("\n", last);
  return [from, nl === -1 ? value.length : nl];
}

function transformLines(
  value: string,
  start: number,
  end: number,
  transform: (lines: ParsedLine[]) => void,
): TextEdit {
  const [from, to] = lineRange(value, start, end);
  const raw = value.slice(from, to).split("\n");
  const parsed = raw.map(parseLine);
  // Blank lines between paragraphs are left as they are, unless there is
  // nothing else: a cursor on an empty line is where a new list starts.
  const blank = raw.map((l) => l.trim() === "");
  const targets = blank.every(Boolean)
    ? parsed
    : parsed.filter((_, i) => !blank[i]);
  transform(targets);
  const next = parsed.map(joinLine);
  const replaced = next.join("\n");

  // Keep the cursor on the text it was on, however long the prefix became.
  const firstDelta = next[0].length - raw[0].length;
  const totalDelta = replaced.length - (to - from);
  const newStart = Math.max(from, start + firstDelta);
  const newEnd =
    start === end ? newStart : Math.max(newStart, end + totalDelta);
  return {
    value: value.slice(0, from) + replaced + value.slice(to),
    selectionStart: newStart,
    selectionEnd: newEnd,
  };
}

function toggleBlock(
  value: string,
  start: number,
  end: number,
  type: Exclude<FormatType, InlineFormat | "link">,
  arg?: string,
): TextEdit {
  return transformLines(value, start, end, (lines) => {
    switch (type) {
      case "heading": {
        const level = Math.min(
          6,
          Math.max(1, Number.parseInt(arg ?? "1", 10) || 1),
        );
        const all = lines.every((l) => headingLevel(l) === level);
        for (const l of lines) l.heading = all ? "" : `${"#".repeat(level)} `;
        break;
      }
      case "quote": {
        const all = lines.every((l) => l.quote !== "");
        for (const l of lines) {
          l.quote = all ? l.quote.replace(/^> ?/, "") : `> ${l.quote}`;
        }
        break;
      }
      case "numberedList": {
        const all = lines.every((l) => isOrdered(l) && l.box === "");
        lines.forEach((l, i) => {
          l.box = "";
          l.marker = all ? "" : `${i + 1}. `;
        });
        break;
      }
      case "unorderedList": {
        const all = lines.every((l) => isBullet(l) && l.box === "");
        for (const l of lines) {
          l.box = "";
          l.marker = all ? "" : "- ";
        }
        break;
      }
      case "checklist": {
        // Mirrors the rich editor: a task item toggles back to a plain list
        // item rather than out of the list altogether.
        const all = lines.every((l) => l.box !== "");
        for (const l of lines) {
          if (all) {
            l.box = "";
          } else if (l.box === "") {
            if (l.marker === "") l.marker = "- ";
            l.box = "[ ] ";
          }
        }
        break;
      }
    }
  });
}

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
    if (inside) return { from, to, text: m[1] };
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
