import type { TextEdit } from "./formatTypes.ts";
import { imagePointer } from "./inlineImages.ts";

// The text color and text font buttons in raw mode, as edits to the Markdown:
// `<span data-color="red">…</span>` and `<span data-font="serif">…</span>`.
// See `extensions/pairInlineTags.ts` for how the text reads them.

export type SpanAttr = "color" | "font";

const CLOSE = "</span>";

const openTag = (attr: SpanAttr, value: string) =>
  `<span data-${attr}="${value}">`;

/** The span of `attr` that ends exactly at `start`, and opens at `end`. */
function wrappingSpan(
  value: string,
  start: number,
  end: number,
  attr: SpanAttr,
): { from: number; to: number } | null {
  if (!value.startsWith(CLOSE, end)) return null;
  const before = value.slice(Math.max(0, start - 60), start);
  const match = new RegExp(`<span data-${attr}="[a-z-]{1,40}">$`).exec(before);
  if (!match) return null;
  return { from: start - match[0].length, to: end + CLOSE.length };
}

/**
 * The value of the `attr` span inside which the caret is, or false. Only the
 * line of the caret counts.
 */
export function rawSpanValue(
  value: string,
  start: number,
  attr: SpanAttr,
): string | false {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const before = value.slice(lineStart, start);
  const re = new RegExp(`<span data-${attr}="([a-z-]{1,40})">`, "g");
  let found: string | false = false;
  for (const m of before.matchAll(re)) {
    const rest = before.slice((m.index ?? 0) + m[0].length);
    found = rest.includes(CLOSE) ? false : (m[1] ?? false);
  }
  return found;
}

/** A span tag of each attribute, and a line end, which also ends all spans. */
const BOUNDARY = /<span data-[a-z]{1,10}="[a-z-]{1,40}">|<\/span>|\n/g;

/**
 * The value of the `attr` span over the selected text: its value, false for
 * none, or null when the selected text has more than one. The tags themselves
 * are not text. Thus, a selection of a full span, tags included, has its value.
 */
export function rawSpanSelectionValue(
  value: string,
  start: number,
  end: number,
  attr: SpanAttr,
): string | false | null {
  if (start >= end) return rawSpanValue(value, start, attr);
  const selected = value.slice(start, end);
  let found: string | false | undefined;
  let from = 0;
  // Each run of text between two boundaries has one value.
  const differs = (to: number): boolean => {
    if (to === from) return false;
    const own = rawSpanValue(value, start + from, attr);
    if (found === undefined) found = own;
    return own !== found;
  };
  for (const m of selected.matchAll(BOUNDARY)) {
    if (differs(m.index)) return null;
    from = m.index + m[0].length;
  }
  if (differs(selected.length)) return null;
  return found ?? rawSpanValue(value, start, attr);
}

/**
 * Gives the selection the color or font `name`, or removes the span around it
 * for the default. A selection that is already exactly in such a span gets the
 * new value in place of a second span.
 */
export function setRawSpan(
  value: string,
  start: number,
  end: number,
  attr: SpanAttr,
  name: string,
): TextEdit | null {
  const clear = name === "" || name === "default";
  const wrap = wrappingSpan(value, start, end, attr);
  const inner = value.slice(start, end);
  const outerFrom = wrap?.from ?? start;
  const outerTo = wrap?.to ?? end;
  if (clear && !wrap) return null;
  const open = clear ? "" : openTag(attr, name);
  const close = clear ? "" : CLOSE;
  const caret = outerFrom + open.length;
  return {
    value:
      value.slice(0, outerFrom) + open + inner + close + value.slice(outerTo),
    selectionStart: caret,
    selectionEnd: caret + inner.length,
  };
}

/** Puts a pointer to image `index` (from 1) of the note at the caret. */
export function insertRawImage(
  value: string,
  start: number,
  end: number,
  index: number,
): TextEdit | null {
  if (!Number.isInteger(index) || index < 1) return null;
  const image = `![](${imagePointer(index)})`;
  const caret = start + image.length;
  return {
    value: value.slice(0, start) + image + value.slice(end),
    selectionStart: caret,
    selectionEnd: caret,
  };
}
