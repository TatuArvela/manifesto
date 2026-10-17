import type { TextEdit } from "./formatTypes.ts";
import { lineRange, parseLine } from "./rawLineFormatting.ts";

// Raw mode's Indent and Outdent: list items moved a level in or out by their
// leading spaces, taking the items nested under them along, as the rich
// editor's `sinkListItem` and `liftListItem` do. Pure string work; see
// `rawFormatting.ts`.

interface Line {
  text: string;
  indent: number;
  /** The marker with its spaces (`- `, `1. `), or "" for a line that is no item. */
  marker: string;
}

const describe = (text: string): Line => {
  const parsed = parseLine(text);
  return { text, indent: parsed.indent.length, marker: parsed.marker };
};

/**
 * The nearest item above `index` whose indent is at most `limit`, looking no
 * further than the list: a line of other text, or two blank lines, end it.
 */
function itemAbove(lines: Line[], index: number, limit: number): Line | null {
  let blanks = 0;
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) break;
    if (line.text.trim() === "") {
      if (++blanks > 1) break;
      continue;
    }
    blanks = 0;
    if (line.marker === "" && line.indent === 0) break;
    if (line.marker !== "" && line.indent <= limit) return line;
  }
  return null;
}

/**
 * One past the last line of the item at `index` and everything nested under
 * it: the lines after it indented further, and blank lines between them.
 */
function subtreeEnd(lines: Line[], index: number): number {
  const indent = lines[index]?.indent ?? 0;
  let end = index + 1;
  let j = index + 1;
  while (j < lines.length) {
    const line = lines[j];
    if (!line) break;
    if (line.text.trim() !== "") {
      if (line.indent <= indent) break;
      end = j + 1;
    }
    j++;
  }
  return end;
}

/**
 * Indents (`dir` 1) or outdents (-1) the list items the selection touches.
 *
 * An item moves in only under an item at its own level just above it, to
 * where that item's text starts, so a numbered list nests under `1. ` by
 * three spaces and a bulleted one under `- ` by two. It moves out to the
 * level of the item it is nested under. Other lines are left as they are.
 */
export function shiftListItems(
  value: string,
  start: number,
  end: number,
  dir: 1 | -1,
): TextEdit {
  const lines = value.split("\n").map(describe);
  const lineOf = (pos: number) => value.slice(0, pos).split("\n").length - 1;
  const [from, to] = lineRange(value, start, end);
  const first = lineOf(from);
  const last = lineOf(to);
  const delta = lines.map(() => 0);

  let i = first;
  while (i <= last) {
    const line = lines[i];
    if (!line || line.marker === "") {
      i++;
      continue;
    }
    let target = line.indent;
    if (dir === 1) {
      const above = itemAbove(lines, i, line.indent);
      if (above && above.indent === line.indent) {
        target = above.indent + above.marker.length;
      }
    } else {
      target = itemAbove(lines, i, line.indent - 1)?.indent ?? 0;
    }
    const shift = target - line.indent;
    const stop = subtreeEnd(lines, i);
    for (let j = i; j < stop && shift !== 0; j++) {
      const moved = lines[j];
      if (!moved || moved.text.trim() === "") continue;
      const indent = Math.max(0, moved.indent + shift);
      delta[j] = indent - moved.indent;
      moved.text = " ".repeat(indent) + moved.text.slice(moved.indent);
      moved.indent = indent;
    }
    i = stop;
  }

  const next = lines.map((l) => l.text).join("\n");
  const original = value.split("\n");
  const map = (pos: number) => {
    const k = lineOf(pos);
    let lineStart = 0;
    for (let n = 0; n < k; n++) lineStart += (lines[n]?.text.length ?? 0) + 1;
    const col =
      pos - original.slice(0, k).reduce((s, l) => s + l.length + 1, 0);
    return lineStart + Math.max(0, col + (delta[k] ?? 0));
  };
  return { value: next, selectionStart: map(start), selectionEnd: map(end) };
}
