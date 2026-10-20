// Pairs the `<u>`, `<sub>` and `<sup>` tags of a parsed note into mark nodes,
// for `manifestoInlineMarks.ts`. It is separate from that file, and has no
// editor. Thus, its tests run in the Node project.

export type InlineTag = "u" | "sub" | "sup";

export const TAG_TO_MDAST: Record<InlineTag, string> = {
  u: "mfUnderline",
  sub: "mfSubscript",
  sup: "mfSuperscript",
};

const OPEN_TAG_RE = /^<(u|sub|sup)(?:\s[^>]*)?>$/i;
const CLOSE_TAG_RE = /^<\/(u|sub|sup)\s*>$/i;

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

export type AnyNode = { type: string; value?: string; children?: AnyNode[] };

/**
 * For each opening tag among `children`, the location of its closing tag. One
 * pass, with a stack for each tag. Thus, a paragraph of tags that nobody closed
 * costs its length, not its length squared. A note is 100,000 characters. A
 * scan ahead from each of 33,000 opening tags stopped the editor of the person
 * who opened it.
 */
function closersOf(children: AnyNode[]): Map<number, number> {
  const closers = new Map<number, number>();
  const open: Record<InlineTag, number[]> = { u: [], sub: [], sup: [] };
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
        if (tag) {
          out.push({
            type: TAG_TO_MDAST[tag],
            children: range(i + 1, close, level + 1),
          });
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
