/**
 * One definition of a checklist line, for all code that must agree: the preview
 * that draws the boxes, the actions that toggle and delete them, and the
 * segmenter that decides which lines belong together. If they do not agree, the
 * preview draws a box that `toggleCheckbox` refuses to change.
 *
 * The trailing space is optional. An item with no label is real (Enter in the
 * editor makes one). If "`] `" was necessary, an empty item would become
 * literal `- [ ]` text that nobody can tick.
 */
const CHECKLIST_RE = /^(\s*)((?:[-*+] )?)\[([ xX])\](?: (.*))?$/;

export interface ChecklistLine {
  /** Leading whitespace, which tells the nesting. */
  indent: string;
  /** The list marker, `""` when the line is a bare `[ ]`. */
  bullet: string;
  checked: boolean;
  /** All after the box. `""` for an item with no label yet. */
  label: string;
}

export function parseChecklistLine(line: string): ChecklistLine | null {
  const m = CHECKLIST_RE.exec(line);
  if (!m) return null;
  const [, indent = "", bullet = "", box = "", label = ""] = m;
  return { indent, bullet, checked: box.toLowerCase() === "x", label };
}

/**
 * Writes again the box of a checklist line, and does not change the indent,
 * marker and label.
 */
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
 * their parent. Thus, a subtree is removed fully. A fence ends the subtree.
 * What is quoted inside it is not a child of this item, and a deletion into it
 * would leave the block open.
 */
export function removeCheckedItems(content: string): string {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  const toRemove = new Set<number>();

  for (const [i, line] of lines.entries()) {
    if (fenced[i]) continue;
    const item = parseChecklistLine(line);
    if (!item?.checked) continue;
    toRemove.add(i);
    const parentIndent = item.indent.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (fenced[j]) break;
      const child = parseChecklistLine(lines[j] ?? "");
      if (!child) break;
      if (child.indent.length <= parentIndent) break;
      toRemove.add(j);
    }
  }

  if (toRemove.size === 0) return content;
  return lines.filter((_, i) => !toRemove.has(i)).join("\n");
}

/** Returns true if a line is a checklist item. */
export function isChecklistLine(line: string): boolean {
  return CHECKLIST_RE.test(line);
}

/**
 * If `content` has a checklist that the user can see. Fenced lines are skipped,
 * as the preview skips them. Inside a code block, `- [x]` is quoted text, not a
 * box.
 */
export function hasChecklist(content: string): boolean {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  return lines.some((line, i) => !fenced[i] && isChecklistLine(line));
}

/** As {@link hasChecklist}, but it counts only boxes that are ticked. */
export function hasCheckedItems(content: string): boolean {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  return lines.some(
    (line, i) => !fenced[i] && parseChecklistLine(line)?.checked === true,
  );
}

/**
 * `content` with the box on `lineIndex` changed, and each indented descendant
 * below it set to agree, as the subtree toggle of the editor does. Null when
 * that line is not a box that can be ticked.
 */
export function toggleChecklistItem(
  content: string,
  lineIndex: number,
): string | null {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  if (fenced[lineIndex]) return null;
  const line = lines[lineIndex];
  const item = parseChecklistLine(line ?? "");
  if (line === undefined || !item) return null;
  const next = !item.checked;
  lines[lineIndex] = setChecklistChecked(line, next);
  for (let i = lineIndex + 1; i < lines.length; i++) {
    if (fenced[i]) break;
    const below = lines[i] ?? "";
    const child = parseChecklistLine(below);
    if (!child || child.indent.length <= item.indent.length) break;
    lines[i] = setChecklistChecked(below, next);
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
  for (const [i, line] of lines.entries()) {
    const fence = FENCE_RE.exec(line)?.[1];
    if (openFence === null) {
      if (fence !== undefined) {
        openFence = fence;
        fenced[i] = true;
      }
      continue;
    }
    fenced[i] = true;
    // CommonMark: only a fence of the same character closes, and it must be
    // at least as long. So a ``` inside a ~~~ block, or inside a ```` one,
    // stays part of the code, which is the only way for a note to document
    // fences.
    if (
      fence !== undefined &&
      fence[0] === openFence[0] &&
      fence.length >= openFence.length
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

  for (const [i, line] of lines.entries()) {
    const type = !fenced[i] && isChecklistLine(line) ? "checklist" : "text";
    const last = segments.at(-1);
    if (last && last.type === type) {
      last.lines.push(line);
    } else {
      segments.push({ type, startLine: i, lines: [line] });
    }
  }

  return segments;
}

/** `content` with each ticked checklist item cleared, for a list used again. */
export function uncheckAllItems(content: string): string {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  return lines
    .map((line, i) =>
      !fenced[i] && parseChecklistLine(line)?.checked
        ? setChecklistChecked(line, false)
        : line,
    )
    .join("\n");
}

/** How many of the checklist items in `content` are ticked, and of how many. */
export function checklistProgress(content: string): {
  done: number;
  total: number;
} {
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  let done = 0;
  let total = 0;
  for (const [i, line] of lines.entries()) {
    if (fenced[i]) continue;
    const item = parseChecklistLine(line);
    if (!item) continue;
    total++;
    if (item.checked) done++;
  }
  return { done, total };
}

interface ItemNode {
  line: string;
  indent: number;
  key: string;
  children: ItemNode[];
}

function sortedLines(items: ItemNode[]): string[] {
  // `sort` is stable. Thus, items with the same key keep the order in which
  // they were written.
  return [...items]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .flatMap((item) => [item.line, ...sortedLines(item.children)]);
}

/**
 * `content` with its checklist items in the order of `keyOf`, smallest first.
 * Items are sorted only among their siblings, in each sequence of checklist
 * lines. The indented children of an item move with it, and are also sorted.
 */
export function sortChecklist(
  content: string,
  keyOf: (item: ChecklistLine | null) => string,
): string {
  const out: string[] = [];
  for (const segment of segmentContent(content)) {
    if (segment.type !== "checklist") {
      out.push(...segment.lines);
      continue;
    }
    const roots: ItemNode[] = [];
    const open: ItemNode[] = [];
    for (const line of segment.lines) {
      const parsed = parseChecklistLine(line);
      const node: ItemNode = {
        line,
        indent: parsed?.indent.length ?? 0,
        key: keyOf(parsed),
        children: [],
      };
      while ((open.at(-1)?.indent ?? -1) >= node.indent) open.pop();
      (open.at(-1)?.children ?? roots).push(node);
      open.push(node);
    }
    out.push(...sortedLines(roots));
  }
  return out.join("\n");
}

/**
 * `content` with the ticked items of each checklist after the items that are
 * still to do, each among its siblings. Both groups keep their order.
 */
export function moveCheckedLast(content: string): string {
  return sortChecklist(content, (item) => (item?.checked ? "1" : "0"));
}
