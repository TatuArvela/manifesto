const CHECKBOX_RE = /^(\s*)(?:- )?\[([ x])\] (.*)$/i;

export interface ContentSegment {
  type: "text" | "checklist";
  startLine: number;
  lines: string[];
}

/** Returns true if a line is a checklist item */
export function isChecklistLine(line: string): boolean {
  return CHECKBOX_RE.test(line);
}

export function segmentContent(content: string): ContentSegment[] {
  const lines = content.split("\n");
  const segments: ContentSegment[] = [];

  for (let i = 0; i < lines.length; i++) {
    const type = isChecklistLine(lines[i]) ? "checklist" : "text";
    const last = segments[segments.length - 1];
    if (last && last.type === type) {
      last.lines.push(lines[i]);
    } else {
      segments.push({ type, startLine: i, lines: [lines[i]] });
    }
  }

  return segments;
}
