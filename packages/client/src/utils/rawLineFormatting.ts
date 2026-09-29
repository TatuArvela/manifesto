import type { FormatType, TextEdit } from "./formatTypes.js";
import type { InlineFormat } from "./rawInlineFormatting.js";

// Raw mode's line formats (headings, quotes, lists, checklists): each line
// taken apart into its prefixes and put back together. Pure string work; see
// `rawFormatting.ts`.

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

export function parseLine(line: string): ParsedLine {
  // Every group but the last matches the empty string, so this always matches.
  const [
    ,
    indent = "",
    quote = "",
    marker = "",
    box = "",
    heading = "",
    text = "",
  ] = LINE_RE.exec(line) ?? [];
  return { indent, quote, marker, box, heading, text };
}

function joinLine(p: ParsedLine): string {
  return p.indent + p.quote + p.marker + p.box + p.heading + p.text;
}

export const isOrdered = (p: ParsedLine) => /^\d/.test(p.marker);
export const isBullet = (p: ParsedLine) => p.marker !== "" && !isOrdered(p);
export const headingLevel = (p: ParsedLine) => p.heading.trim().length;

/** The whole lines the selection touches, as offsets into `value`. */
export function lineRange(
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
  const firstDelta = (next[0]?.length ?? 0) - (raw[0]?.length ?? 0);
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

export function toggleBlock(
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
