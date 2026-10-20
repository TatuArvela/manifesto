import { markFencedLines } from "./markdown.ts";

// What the serializer of the rich editor writes, made the same as what the
// preview renders. Thus, a note read out of the editor comes back without
// change.

/**
 * prosemirror-markdown escapes `[` `]` as CommonMark says. Our content uses
 * literal brackets (for example "Post [ ] Maa"). Thus, we remove the escapes on
 * readout.
 *
 * Not inside a code block. There, the backslash is content, and a note that
 * showed how to escape a bracket had its own example silently changed. Code
 * spans are not changed for the same reason.
 */
function unescapeBrackets(md: string): string {
  const lines = md.split("\n");
  const fenced = markFencedLines(lines);
  return lines
    .map((line, i) => (fenced[i] ? line : line.replace(/\\([[\]])/g, "$1")))
    .join("\n");
}

const LIST_LINE_RE = /^\s*(?:[-*+] |\d+[.)] )/;

/**
 * The "spread" lists of mdast insert blank lines between items on stringify.
 * Our preview treats each blank line as a segment gap, which changes a simple
 * checklist into separate blocks. Collapse blank lines that are only between
 * two list items, never inside a fence. There, a blank line between two lines
 * that start with `-` is part of the code.
 */
function collapseListSpread(md: string): string {
  const lines = md.split("\n");
  const fenced = markFencedLines(lines);
  const out: string[] = [];
  let i = 0;
  const blankAt = (k: number) => lines[k]?.trim() === "" && !fenced[k];
  while (i < lines.length) {
    const prev = out.at(-1);
    if (prev !== undefined && blankAt(i)) {
      let j = i;
      while (blankAt(j)) j++;
      const next = lines[j] ?? "";
      if (!fenced[j] && LIST_LINE_RE.test(prev) && LIST_LINE_RE.test(next)) {
        i = j;
        continue;
      }
    }
    out.push(lines[i] ?? "");
    i++;
  }
  return out.join("\n");
}

/**
 * The two post-processing passes above, in the order that the `getMarkdown` of
 * the editor needs.
 */
export function normalizeMarkdown(md: string): string {
  return collapseListSpread(unescapeBrackets(md));
}

/**
 * Replaces the text of a textarea with a change made in a different place, and
 * keeps the caret on the same text. If the change is after the caret, the caret
 * does not move. If the change is before it, the caret moves with it.
 */
export function replaceTextareaText(
  textarea: HTMLTextAreaElement | null,
  next: string,
): void {
  if (!textarea) return;
  const old = textarea.value;
  const focused = document.activeElement === textarea;
  const { selectionStart, selectionEnd } = textarea;
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
  const map = (pos: number) =>
    pos <= prefix
      ? pos
      : pos >= old.length - suffix
        ? pos + next.length - old.length
        : next.length - suffix;
  textarea.value = next;
  if (focused)
    textarea.setSelectionRange(map(selectionStart), map(selectionEnd));
}
