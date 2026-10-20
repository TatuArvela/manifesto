import type { TextEdit } from "./formatTypes.ts";
import { lineRange } from "./rawLineFormatting.ts";

// The whole blocks of raw mode (a divider, a table, a code block): text on
// lines of its own. Only string operations. See `rawFormatting.ts`.

/**
 * Puts `block` in after the paragraph in which the selection ends (a sequence
 * of lines with no blank line between, thus a full list). Or it puts it in
 * place of the selected lines when they are blank, with an empty line on each
 * side. The rich editor also puts one there. The blank line above is not only
 * for a clean look. `---` directly under a line of text is the heading
 * underline of that line, not a divider.
 *
 * `caret` is where the caret goes, as an offset into `block`. A value past its
 * end continues into the empty line below it. Thus, `block.length + 2` is the
 * start of the content that follows.
 */
export function insertRawBlock(
  value: string,
  start: number,
  end: number,
  block: string,
  caret: number,
): TextEdit {
  const [from, lineEnd] = lineRange(value, start, end);
  const blank = value.slice(from, lineEnd).trim() === "";
  const gap = /\n[ \t]*\n/g;
  gap.lastIndex = lineEnd;
  const to = blank ? lineEnd : (gap.exec(value)?.index ?? value.length);
  const before = value.slice(0, blank ? from : to);
  const after = value.slice(to);
  const lead =
    before === "" || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const trail = after.startsWith("\n\n")
    ? ""
    : after.startsWith("\n")
      ? "\n"
      : "\n\n";
  const at = before.length + lead.length + caret;
  return {
    value: before + lead + block + trail + after,
    selectionStart: at,
    selectionEnd: at,
  };
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/** The line `pos` is on, as an index into `value.split("\n")`. */
const lineOf = (value: string, pos: number) =>
  value.slice(0, pos).split("\n").length - 1;

/**
 * The fenced code block the line `line` is in, as the indexes of its opening
 * and closing fence lines; a fence line itself counts as in. A block never
 * closed runs to the end of the text, as CommonMark has it, and then has no
 * `close`.
 */
function enclosingFence(
  lines: string[],
  line: number,
): { open: number; close: number | null } | null {
  let open = -1;
  let marker = "";
  for (const [i, text] of lines.entries()) {
    const fence = FENCE_RE.exec(text)?.[1];
    if (open === -1) {
      if (i > line) return null;
      if (fence) {
        open = i;
        marker = fence;
      }
      continue;
    }
    // A closing fence is the same character, at least as long, and alone.
    if (
      fence !== undefined &&
      fence[0] === marker[0] &&
      fence.length >= marker.length &&
      text.trim() === fence
    ) {
      if (i >= line) return { open, close: i };
      open = -1;
    }
  }
  return open === -1 ? null : { open, close: null };
}

/** Whether the caret's line is in a fenced code block. */
export function inRawCodeBlock(value: string, start: number): boolean {
  return enclosingFence(value.split("\n"), lineOf(value, start)) !== null;
}

/**
 * Takes the fences off the code block the selection starts in, or fences the
 * lines the selection touches. The selection stays on the text it was on.
 */
export function toggleRawCodeBlock(
  value: string,
  start: number,
  end: number,
): TextEdit {
  const lines = value.split("\n");
  const fence = enclosingFence(lines, lineOf(value, start));
  if (!fence) {
    const [from, to] = lineRange(value, start, end);
    const open = "```\n";
    return {
      value: `${value.slice(0, from)}${open}${value.slice(from, to)}\n\`\`\`${value.slice(to)}`,
      selectionStart: start + open.length,
      selectionEnd: end + open.length,
    };
  }

  // Each fence line goes with one newline: the newline after the opening fence,
  // and the newline before the closing fence.
  const lineStart = (i: number) =>
    lines.slice(0, i).reduce((sum, l) => sum + l.length + 1, 0);
  const openFrom = lineStart(fence.open);
  const openTo = Math.min(
    value.length,
    openFrom + (lines[fence.open]?.length ?? 0) + 1,
  );
  const cut: [number, number][] = [[openFrom, openTo]];
  if (fence.close !== null) {
    const closeFrom = lineStart(fence.close);
    // An empty block has one newline between its fences, which is already used.
    cut.push([
      Math.max(openTo, closeFrom - 1),
      closeFrom + (lines[fence.close]?.length ?? 0),
    ]);
  }
  const map = (pos: number) => {
    let mapped = pos;
    for (const [from, to] of cut) {
      if (pos >= to) mapped -= to - from;
      else if (pos > from) mapped -= pos - from;
    }
    return mapped;
  };
  let next = value;
  for (const [from, to] of [...cut].reverse()) {
    next = next.slice(0, from) + next.slice(to);
  }
  return {
    value: next,
    selectionStart: map(start),
    selectionEnd: map(end),
  };
}
