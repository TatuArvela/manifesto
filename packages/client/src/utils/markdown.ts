/**
 * One definition of what a checklist line is, for everyone who has to agree:
 * the preview that draws the boxes, the actions that toggle and delete them,
 * and the segmenter that decides which lines belong together. If they
 * disagree, the preview draws a box that `toggleCheckbox` refuses to touch.
 *
 * The trailing space is optional. An item with no label is a real thing
 * (pressing Enter in the editor makes one); requiring "`] `" would turn an
 * empty item into literal `- [ ]` text that can never be checked.
 */
const CHECKLIST_RE = /^(\s*)((?:[-*+] )?)\[([ xX])\](?: (.*))?$/;

export interface ChecklistLine {
  /** Leading whitespace, which is what nesting is expressed in. */
  indent: string;
  /** The list marker, `""` when the line is a bare `[ ]`. */
  bullet: string;
  checked: boolean;
  /** Everything after the box; `""` for an item with no label yet. */
  label: string;
}

export function parseChecklistLine(line: string): ChecklistLine | null {
  const m = CHECKLIST_RE.exec(line);
  if (!m) return null;
  return {
    indent: m[1],
    bullet: m[2],
    checked: m[3].toLowerCase() === "x",
    label: m[4] ?? "",
  };
}

/** Rewrites a checklist line's box, leaving indent, marker and label alone. */
export function setChecklistChecked(line: string, checked: boolean): string {
  const parsed = parseChecklistLine(line);
  if (!parsed) return line;
  const box = checked ? "x" : " ";
  return parsed.label
    ? `${parsed.indent}${parsed.bullet}[${box}] ${parsed.label}`
    : `${parsed.indent}${parsed.bullet}[${box}]`;
}

/**
 * `content` without its ticked checklist items. Indented descendants go with
 * their parent, so a subtree is removed whole. A fence ends the subtree:
 * whatever is quoted inside it is not this item's child, and deleting into it
 * would leave the block unterminated.
 */
export function removeCheckedItems(content: string): string {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  const toRemove = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const item = parseChecklistLine(lines[i]);
    if (!item?.checked) continue;
    toRemove.add(i);
    const parentIndent = item.indent.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (fenced[j]) break;
      const child = parseChecklistLine(lines[j]);
      if (!child) break;
      if (child.indent.length <= parentIndent) break;
      toRemove.add(j);
    }
  }

  if (toRemove.size === 0) return content;
  return lines.filter((_, i) => !toRemove.has(i)).join("\n");
}

/** Returns true if a line is a checklist item */
export function isChecklistLine(line: string): boolean {
  return CHECKLIST_RE.test(line);
}

/**
 * Whether `content` has a checklist the user can see. Fenced lines are
 * skipped, as the preview skips them: inside a code block `- [x]` is quoted
 * text, not a box.
 */
export function hasChecklist(content: string): boolean {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  return lines.some((line, i) => !fenced[i] && isChecklistLine(line));
}

/** As {@link hasChecklist}, but only counting boxes that are ticked. */
export function hasCheckedItems(content: string): boolean {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  return lines.some(
    (line, i) => !fenced[i] && parseChecklistLine(line)?.checked === true,
  );
}

/**
 * `content` with the box on `lineIndex` flipped, and every indented
 * descendant below it set to match, as the editor's subtree toggle does.
 * Null when that line is not a box that can be ticked.
 */
export function toggleChecklistItem(
  content: string,
  lineIndex: number,
): string | null {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  if (fenced[lineIndex]) return null;
  const item = parseChecklistLine(lines[lineIndex] ?? "");
  if (!item) return null;
  const next = !item.checked;
  lines[lineIndex] = setChecklistChecked(lines[lineIndex], next);
  for (let i = lineIndex + 1; i < lines.length; i++) {
    if (fenced[i]) break;
    const child = parseChecklistLine(lines[i]);
    if (!child || child.indent.length <= item.indent.length) break;
    lines[i] = setChecklistChecked(lines[i], next);
  }
  return lines.join("\n");
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Marks every line that sits inside a fenced code block, fences included.
 *
 * Line-at-a-time rules ("is this a checklist?", "is this a list item?",
 * "unescape these brackets") are all wrong inside a fence, where the text is
 * data rather than markup: a note quoting checklist syntax in a code block
 * must not have it rendered as live checkboxes.
 */
export function markFencedLines(lines: string[]): boolean[] {
  const fenced: boolean[] = new Array(lines.length).fill(false);
  let openFence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const match = FENCE_RE.exec(lines[i]);
    if (openFence === null) {
      if (match) {
        openFence = match[1];
        fenced[i] = true;
      }
      continue;
    }
    fenced[i] = true;
    // CommonMark: only a fence of the same character closes, and it must be
    // at least as long. So a ``` inside a ~~~ block, or inside a ```` one,
    // stays part of the code, which is how a note documents fences at all.
    if (
      match &&
      match[1][0] === openFence[0] &&
      match[1].length >= openFence.length
    ) {
      openFence = null;
    }
  }
  return fenced;
}

export interface ContentSegment {
  type: "text" | "checklist";
  startLine: number;
  lines: string[];
}

export function segmentContent(content: string): ContentSegment[] {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  const segments: ContentSegment[] = [];

  for (let i = 0; i < lines.length; i++) {
    const type = !fenced[i] && isChecklistLine(lines[i]) ? "checklist" : "text";
    const last = segments[segments.length - 1];
    if (last && last.type === type) {
      last.lines.push(lines[i]);
    } else {
      segments.push({ type, startLine: i, lines: [lines[i]] });
    }
  }

  return segments;
}
