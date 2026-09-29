import type { TextEdit } from "./formatTypes.js";

// Raw mode's inline formats (bold, italic, code, strikethrough and the HTML
// tags): finding the markers around the text and adding or removing them.
// Pure string work; see `rawFormatting.ts`.

export type InlineFormat =
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

function isMarker(char: string | undefined): boolean {
  return char !== undefined && MARKER_CHARS.includes(char);
}
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
    } else if (isMarker(value[pos - 1])) {
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
    } else if (isMarker(value[pos])) {
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
export function inlineRange(
  value: string,
  start: number,
  end: number,
): [number, number] {
  if (start !== end) {
    while (start < end && /\s/.test(value.charAt(start))) start++;
    while (end > start && /\s/.test(value.charAt(end - 1))) end--;
    return peelMarkup(value, start, end);
  }
  let from = start;
  let to = start;
  while (from > 0 && !/\s/.test(value.charAt(from - 1))) from--;
  while (to < value.length && !/\s/.test(value.charAt(to))) to++;
  if (from === to) return [start, start];
  const word = value.slice(from, to);
  const lead = EDGE_MARKUP_START.exec(word)?.[0].length ?? 0;
  const trail = EDGE_MARKUP_END.exec(word.slice(lead))?.[0].length ?? 0;
  const coreFrom = from + lead;
  const coreTo = to - trail;
  // A word that is all markup has no text to format: leave the cursor where
  // it is. A cursor in the markup of a word that has text belongs to that
  // word, the same as one in its letters; measured from the cursor instead,
  // `*|*aa**` read as an `*` either side of it, which is italic.
  if (coreFrom >= coreTo) return [start, start];
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
export function wrappedBy(
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
    // A bare cursor inside one run of markers, with no text either side of
    // it, is only a pair of empty markers when it sits in the middle: `**|**`
    // is the empty bold a press of Bold just inserted, `*|***` is not italic.
    if (
      from === to &&
      open.to === close.from &&
      open.text.length !== close.text.length
    ) {
      continue;
    }
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

export function toggleInline(
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
