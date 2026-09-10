/**
 * One definition of what a checklist line is, for everyone who has to agree:
 * the preview that draws the boxes, the actions that toggle and delete them,
 * and the segmenter that decides which lines belong together. Three copies of
 * this pattern used to drift — a line the preview drew a box for could be one
 * `toggleCheckbox` refused to touch.
 *
 * The trailing space is optional. An item with no label is a real thing —
 * pressing Enter in the editor makes one — and requiring "`] `" meant an empty
 * item stopped being a checklist line and re-rendered as literal `- [ ]` text
 * that could never be checked again.
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

/** Returns true if a line is a checklist item */
export function isChecklistLine(line: string): boolean {
  return CHECKLIST_RE.test(line);
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Marks every line that sits inside a fenced code block, fences included.
 *
 * Line-at-a-time rules — "is this a checklist?", "is this a list item?",
 * "unescape these brackets" — are all wrong inside a fence, where the text is
 * data rather than markup. A note documenting our own checklist syntax in a
 * code block used to have that block cut in half and rendered as live
 * checkboxes.
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
    // stays part of the code — which is how a note documents fences at all.
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
