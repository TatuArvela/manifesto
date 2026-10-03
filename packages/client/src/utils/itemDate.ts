import {
  markFencedLines,
  parseChecklistLine,
  segmentContent,
} from "./markdown.js";

/**
 * A date on a checklist item: an `@2026-10-02` token in the item's own text.
 * The Markdown stays the only source of truth, so the token is found again
 * wherever the item is drawn (the card, the read-only views, the editor)
 * rather than stored anywhere. This file is the one definition they share.
 */

/** Every quantifier is bounded: this runs on each card render. */
const ITEM_DATE_RE = /(?:^|\s)@(\d{4})-(\d{2})-(\d{2})(?![\w-])/g;

export interface ItemDate {
  /** `YYYY-MM-DD`, which also sorts as a date. */
  date: string;
  /** Where the token, `@` included, sits in the text searched. */
  start: number;
  end: number;
}

/** A day that exists: `2026-02-30` is text, not a date. */
function isCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * The first date token in `text`, or null. `text` is plain text with no
 * Markdown in it, as a text node of the editor or of the rendered HTML is.
 */
export function findItemDate(text: string): ItemDate | null {
  for (const m of text.matchAll(ITEM_DATE_RE)) {
    const [whole, year = "", month = "", day = ""] = m;
    if (!isCalendarDate(Number(year), Number(month), Number(day))) continue;
    const end = m.index + whole.length;
    return { date: `${year}-${month}-${day}`, start: end - 11, end };
  }
  return null;
}

/**
 * The date of a checklist item given its label as Markdown. A token inside
 * a code span is quoted text, as it is where the label is rendered.
 */
export function labelDate(label: string): string | null {
  const found = findItemDate(label);
  if (!found) return null;
  const ticksBefore = label.slice(0, found.start).split("`").length - 1;
  return ticksBefore % 2 === 1 ? null : found.date;
}

/** Today in the user's own time zone, as the token writes a date. */
export function localIsoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The classes of a date chip. Overdue is a date before today on an item not
 * yet ticked; a ticked item is done whenever it was due.
 */
export function itemDateClass(
  date: string,
  checked: boolean,
  today: string,
): string {
  return !checked && date < today ? "item-date item-date-overdue" : "item-date";
}

/** Sorts after every real date, so undated items keep the end of the list. */
export const UNDATED = "9999-99-99";

/** Whether `content` has a dated checklist item the user can see. */
export function hasDatedItems(content: string): boolean {
  if (!content.includes("@")) return false;
  const lines = content.split("\n");
  const fenced = markFencedLines(lines);
  return lines.some((line, i) => {
    if (fenced[i]) return false;
    const item = parseChecklistLine(line);
    return item !== null && labelDate(item.label) !== null;
  });
}

interface ItemNode {
  line: string;
  indent: number;
  key: string;
  children: ItemNode[];
}

function sortedLines(items: ItemNode[]): string[] {
  // `sort` is stable, so items sharing a date, and the undated ones, keep the
  // order they were written in.
  return [...items]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .flatMap((item) => [item.line, ...sortedLines(item.children)]);
}

/**
 * `content` with its checklist items in date order, soonest first and undated
 * last. Items are sorted among their siblings only, in each run of checklist
 * lines, and an item's indented children move with it, sorted in turn.
 */
export function sortChecklistByDate(content: string): string {
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
        key: (parsed && labelDate(parsed.label)) ?? UNDATED,
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
