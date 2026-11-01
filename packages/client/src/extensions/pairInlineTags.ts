// Pairs the `<u>`, `<sub>`, `<sup>` and `<span>` tags of a parsed note into
// mark nodes, for `manifestoInlineMarks.ts`. It is separate from that file, and has no
// editor. Thus, its tests run in the Node project.

import { NoteColor, NoteFont } from "@manifesto/shared";

export type InlineTag = "u" | "sub" | "sup" | "span";

export const TAG_TO_MDAST: Record<Exclude<InlineTag, "span">, string> = {
  u: "mfUnderline",
  sub: "mfSubscript",
  sup: "mfSuperscript",
};

/** The mdast types of the two spans, and the attribute that each one has. */
export const TEXT_COLOR_MDAST = "mfTextColor";
export const TEXT_FONT_MDAST = "mfTextFont";

const OPEN_TAG_RE = /^<(u|sub|sup|span)(?:\s[^>]*)?>$/i;
const CLOSE_TAG_RE = /^<\/(u|sub|sup|span)\s*>$/i;
const SPAN_ATTR_RE = /^<span\s+data-(color|font)="([a-z-]{1,40})"\s*>$/i;

const COLORS = new Set<string>(Object.values(NoteColor));
const FONTS = new Set<string>(Object.values(NoteFont));

/**
 * The mark node of an opening `<span>`, without its children. Only a span with
 * exactly one `data-color` or `data-font` of a known value is a mark. All other
 * spans stay raw HTML, as before. The default of each is no span.
 */
function spanMark(value: string): AnyNode | null {
  const [, attr = "", name = ""] = SPAN_ATTR_RE.exec(value.trim()) ?? [];
  const key = name.toLowerCase();
  if (attr.toLowerCase() === "color" && COLORS.has(key)) {
    if (key === NoteColor.Default) return null;
    return { type: TEXT_COLOR_MDAST, attrs: { color: key } };
  }
  if (attr.toLowerCase() === "font" && FONTS.has(key)) {
    if (key === NoteFont.Default) return null;
    return { type: TEXT_FONT_MDAST, attrs: { font: key } };
  }
  return null;
}

/**
 * How deep marks can nest before the remaining text stays as it was written.
 * Nobody underlines an underline a hundred times, and each level is one call
 * deeper.
 */
const MAX_MARK_DEPTH = 100;

function matchOpenTag(value: string): InlineTag | null {
  const tag = OPEN_TAG_RE.exec(value.trim())?.[1];
  return tag ? (tag.toLowerCase() as InlineTag) : null;
}

function matchCloseTag(value: string): InlineTag | null {
  const tag = CLOSE_TAG_RE.exec(value.trim())?.[1];
  return tag ? (tag.toLowerCase() as InlineTag) : null;
}

export type AnyNode = {
  type: string;
  value?: string;
  children?: AnyNode[];
  attrs?: Record<string, string>;
};

/**
 * For each opening tag among `children`, the location of its closing tag. One
 * pass, with a stack for each tag. Thus, a paragraph of tags that nobody closed
 * costs its length, not its length squared. A note is 100,000 characters. A
 * scan ahead from each of 33,000 opening tags stopped the editor of the person
 * who opened it.
 */
function closersOf(children: AnyNode[]): Map<number, number> {
  const closers = new Map<number, number>();
  const open: Record<InlineTag, number[]> = {
    u: [],
    sub: [],
    sup: [],
    span: [],
  };
  for (const [i, node] of children.entries()) {
    if (node.type !== "html" || typeof node.value !== "string") continue;
    const opened = matchOpenTag(node.value);
    if (opened) {
      open[opened].push(i);
      continue;
    }
    const closed = matchCloseTag(node.value);
    const from = closed ? open[closed].pop() : undefined;
    if (from !== undefined) closers.set(from, i);
  }
  return closers;
}

/**
 * `children`, with each tag pair replaced by a mark node that contains the
 * content between them, all the way down. A tag with no partner stays as it is.
 * So does a pair that would cross the end of a different pair.
 */
export function pairChildren(children: AnyNode[], marks = 0): AnyNode[] {
  const closers = closersOf(children);
  const range = (from: number, to: number, level: number): AnyNode[] => {
    const out: AnyNode[] = [];
    let i = from;
    while (i < to) {
      const node = children[i];
      if (!node) break;
      const close = closers.get(i);
      if (
        close !== undefined &&
        close < to &&
        level < MAX_MARK_DEPTH &&
        typeof node.value === "string"
      ) {
        const tag = matchOpenTag(node.value);
        // A span that is not a mark still pairs with its `</span>`. Thus, a
        // later colored span does not take the wrong closing tag. Both stay
        // raw.
        const mark =
          tag === "span"
            ? spanMark(node.value)
            : tag
              ? { type: TAG_TO_MDAST[tag] }
              : null;
        if (mark) {
          out.push({ ...mark, children: range(i + 1, close, level + 1) });
          i = close + 1;
          continue;
        }
      }
      out.push(
        node.children
          ? { ...node, children: pairChildren(node.children, level) }
          : node,
      );
      i++;
    }
    return out;
  };
  return range(0, children.length, marks);
}
