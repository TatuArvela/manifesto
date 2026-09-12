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
const MARKUP_TOKEN = /<(?:u|sub|sup)>|([*_~`])\1*/g;
const MARKER_CHARS = "*_~`";
const OPEN_TAG_BEFORE = /<(?:u|sub|sup)>$/;
const CLOSE_TAG_AFTER = /^<\/(?:u|sub|sup)>/;

/** A piece of inline markup beside the text: a tag, or a run of one marker. */
interface Token {
  text: string;
  from: number;
  to: number;
}

/** The markup directly before `pos`, nearest first. */
function tokensBefore(value: string, pos: number): Token[] {
  const tokens: Token[] = [];
  while (pos > 0) {
    const tag = OPEN_TAG_BEFORE.exec(value.slice(Math.max(0, pos - 5), pos));
    let from = pos - 1;
    if (tag) {
      from = pos - tag[0].length;
    } else if (MARKER_CHARS.includes(value[pos - 1])) {
      while (from > 0 && value[from - 1] === value[pos - 1]) from--;
    } else {
      break;
    }
    tokens.push({ text: value.slice(from, pos), from, to: pos });
    pos = from;
  }
  return tokens;
}

/** The markup directly after `pos`, nearest first. */
function tokensAfter(value: string, pos: number): Token[] {
  const tokens: Token[] = [];
  while (pos < value.length) {
    const tag = CLOSE_TAG_AFTER.exec(value.slice(pos, pos + 6));
    let to = pos + 1;
    if (tag) {
      to = pos + tag[0].length;
    } else if (MARKER_CHARS.includes(value[pos])) {
      while (to < value.length && value[to] === value[pos]) to++;
    } else {
      break;
    }
    tokens.push({ text: value.slice(pos, to), from: pos, to });
    pos = to;
  }
  return tokens;
}

/**
 * `from`..`to` with the markup hugging both ends of it removed, or unchanged
 * if there is none to remove.
 *
 * Only markup at both ends is a wrapper: `**word` on its own is text with
 * asterisks in it, and formatting just `word` inside it would leave an
 * unbalanced `****word**`. Nor is it one when the same markup turns up again
 * inside: the outer asterisks of `**a** and **b**` belong to two separate runs,
 * and taking them for one would unwrap the selection into `a** and **b`.
 */
function peelMarkup(value: string, from: number, to: number): [number, number] {
  const text = value.slice(from, to);
  const lead = EDGE_MARKUP_START.exec(text)?.[0] ?? "";
  const trail = EDGE_MARKUP_END.exec(text.slice(lead.length))?.[0] ?? "";
  if (!lead || !trail || lead.length + trail.length >= text.length) {
    return [from, to];
  }
  const core = text.slice(lead.length, text.length - trail.length);
  for (const [token] of lead.matchAll(MARKUP_TOKEN)) {
    if (core.includes(token)) return [from, to];
  }
  return [from + lead.length, to - trail.length];
}

/**
 * The range an inline format applies to: the selection without surrounding
 * whitespace (`** bold **` is not bold), or with nothing selected, the word
 * under the cursor. Either way minus any markup already wrapping the text, so
 * that pressing Bold on `**word**` finds the markers to take away rather than
 * nesting more, whether the caret is in the word or the selection takes in
 * the asterisks too.
 */
function inlineRange(
  value: string,
  start: number,
  end: number,
): [number, number] {
  if (start !== end) {
    while (start < end && /\s/.test(value[start])) start++;
    while (end > start && /\s/.test(value[end - 1])) end--;
    return peelMarkup(value, start, end);
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
 * Where the markers that turn `format` on sit around `from`..`to`, as the two
 * spans to delete to turn it off, or null if it is not on.
 *
 * Looks through all the markup beside the text rather than only the innermost
 * piece, so `<u>**word**</u>` is underlined even though `**` is what touches
 * the word. `*` and `_` are read as runs because they share a character
 * between two formats: a run of one is italic, two is bold, three is both, and
 * the markers taken are the ones nearest the text.
 */
function wrappedBy(
  value: string,
  from: number,
  to: number,
  format: InlineFormat,
): { left: [number, number]; right: [number, number] } | null {
  const before = tokensBefore(value, from);
  const after = tokensAfter(value, to);
  const tag = TAGS[format];
  if (tag) {
    const open = before.find((t) => t.text === `<${tag}>`);
    const close = after.find((t) => t.text === `</${tag}>`);
    return open && close
      ? { left: [open.from, open.to], right: [close.from, close.to] }
      : null;
  }
  const chars =
    format === "code" ? ["`"] : format === "strikethrough" ? ["~"] : ["*", "_"];
  for (const ch of chars) {
    const open = before.find((t) => t.text[0] === ch);
    const close = after.find((t) => t.text[0] === ch);
    if (!open || !close) continue;
    const n = Math.min(open.text.length, close.text.length);
    let take = 0;
    if (format === "bold" && n >= 2) take = 2;
    else if (format === "italic" && n % 2 === 1) take = 1;
    else if (format === "strikethrough" && n >= 2) take = 2;
    else if (format === "code" && n >= 1) take = n;
    if (take > 0) {
      return {
        left: [open.to - take, open.to],
        right: [close.from, close.from + take],
      };
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
    const { left, right } = existing;
    const shift = left[1] - left[0];
    return {
      value:
        value.slice(0, left[0]) +
        value.slice(left[1], right[0]) +
        value.slice(right[1]),
      selectionStart: from - shift,
      selectionEnd: to - shift,
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
