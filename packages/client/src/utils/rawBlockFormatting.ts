import type { TextEdit } from "./formatTypes.js";
import { lineRange } from "./rawLineFormatting.js";

// Raw mode's whole blocks (a divider, a table): text put in on lines of its
// own. Pure string work; see `rawFormatting.ts`.

/**
 * Puts `block` in after the paragraph the selection ends in (a run of lines
 * with no blank one between, so a whole list), or in place of the selected
 * lines when they are blank, with an empty line on either side. That is
 * where the rich editor puts one too. The blank line
 * above is not only tidiness: `---` straight under a line of text is that
 * line's heading underline, not a divider.
 *
 * `caret` is where the caret lands, as an offset into `block`; past its end
 * counts on into the empty line below it, so `block.length + 2` is the start
 * of whatever follows.
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
