import { markFencedLines } from "./markdown.js";

// What the rich editor's serializer writes, brought in line with what the
// preview renders, so a note read out of the editor round-trips unchanged.

/** prosemirror-markdown escapes `[` `]` per CommonMark; our content uses literal
 * brackets (e.g. "Post [ ] Maa"), so we unescape them on readout.
 *
 * Not inside a code block: there the backslash is content, and a note showing
 * how to escape a bracket had its own example silently corrected. Code spans
 * are left alone for the same reason. */
function unescapeBrackets(md: string): string {
  const lines = md.split("\n");
  const fenced = markFencedLines(lines);
  return lines
    .map((line, i) => (fenced[i] ? line : line.replace(/\\([[\]])/g, "$1")))
    .join("\n");
}

const LIST_LINE_RE = /^\s*(?:[-*+] |\d+[.)] )/;

/** mdast's "spread" lists insert blank lines between items on stringify. Our
 * preview treats each blank line as a segment gap, which balloons a simple
 * checklist into disconnected blocks. Collapse blank lines that only sit
 * between two list items, never inside a fence, where a blank line between
 * two lines that happen to start with `-` is part of the code. */
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
 * The two post-processing passes above, in the order the editor's
 * `getMarkdown` needs them.
 */
export function normalizeMarkdown(md: string): string {
  return collapseListSpread(unescapeBrackets(md));
}

/**
 * Replaces a textarea's text with a change made elsewhere, keeping the caret
 * on the same text: before the change it stays put, after it moves with it.
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
