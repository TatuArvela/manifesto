import {
  remarkPluginsCtx,
  remarkStringifyOptionsCtx,
} from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { $command, $markSchema } from "@milkdown/kit/utils";
import type { Handle, Handlers } from "mdast-util-to-markdown";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

type InlineTag = "u" | "sub" | "sup";

const TAG_TO_MDAST: Record<InlineTag, string> = {
  u: "mfUnderline",
  sub: "mfSubscript",
  sup: "mfSuperscript",
};

const OPEN_TAG_RE = /^<(u|sub|sup)(?:\s[^>]*)?>$/i;
const CLOSE_TAG_RE = /^<\/(u|sub|sup)\s*>$/i;

function matchOpenTag(value: string): InlineTag | null {
  const m = OPEN_TAG_RE.exec(value.trim());
  return m ? (m[1].toLowerCase() as InlineTag) : null;
}

function matchCloseTag(value: string): InlineTag | null {
  const m = CLOSE_TAG_RE.exec(value.trim());
  return m ? (m[1].toLowerCase() as InlineTag) : null;
}

type AnyNode = { type: string; value?: string; children?: AnyNode[] };

function pairChildren(children: AnyNode[]): AnyNode[] {
  const out: AnyNode[] = [];
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (node.type === "html" && typeof node.value === "string") {
      const open = matchOpenTag(node.value);
      if (open) {
        let depth = 1;
        let j = i + 1;
        for (; j < children.length; j++) {
          const c = children[j];
          if (c.type !== "html" || typeof c.value !== "string") continue;
          if (matchOpenTag(c.value) === open) depth++;
          else if (matchCloseTag(c.value) === open) {
            depth--;
            if (depth === 0) break;
          }
        }
        if (j < children.length) {
          const inner = pairChildren(children.slice(i + 1, j));
          out.push({ type: TAG_TO_MDAST[open], children: inner });
          i = j + 1;
          continue;
        }
      }
    }
    if (node.children) {
      out.push({ ...node, children: pairChildren(node.children) });
    } else {
      out.push(node);
    }
    i++;
  }
  return out;
}

const remarkManifestoInlineMarks: Plugin<[], AnyNode> = () => {
  return (tree) => {
    visit(tree, (node: AnyNode) => {
      if (node.children) {
        node.children = pairChildren(node.children);
      }
    });
  };
};

function makeMarkSchema(id: string, mdastType: string, tag: InlineTag) {
  return $markSchema(id, () => ({
    parseDOM: [{ tag }],
    toDOM: () => [tag, 0] as [string, 0],
    parseMarkdown: {
      match: (node) => node.type === mdastType,
      runner: (state, node, markType) => {
        state.openMark(markType);
        state.next(node.children ?? []);
        state.closeMark(markType);
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === id,
      runner: (state, mark) => {
        state.withMark(mark, mdastType);
      },
    },
  }));
}

export const underlineSchema = makeMarkSchema("underline", "mfUnderline", "u");
export const subscriptSchema = makeMarkSchema(
  "subscript",
  "mfSubscript",
  "sub",
);
export const superscriptSchema = makeMarkSchema(
  "superscript",
  "mfSuperscript",
  "sup",
);

export const toggleUnderlineCommand = $command(
  "ToggleUnderline",
  (ctx) => () => toggleMark(underlineSchema.type(ctx)),
);

export const toggleSubscriptCommand = $command(
  "ToggleSubscript",
  (ctx) => () => toggleMark(subscriptSchema.type(ctx)),
);

export const toggleSuperscriptCommand = $command(
  "ToggleSuperscript",
  (ctx) => () => toggleMark(superscriptSchema.type(ctx)),
);

function makeTagHandler(tag: InlineTag): Handle {
  return (node, _parent, state, info) => {
    const content = state.containerPhrasing(
      node as unknown as Parameters<typeof state.containerPhrasing>[0],
      info,
    );
    return `<${tag}>${content}</${tag}>`;
  };
}

export const manifestoInlineMarksConfig: MilkdownPlugin = (ctx) => () => {
  ctx.update(remarkPluginsCtx, (plugins) => [
    ...plugins,
    // biome-ignore lint/suspicious/noExplicitAny: remark plugin type erasure
    { plugin: remarkManifestoInlineMarks as any, options: {} },
  ]);
  ctx.update(remarkStringifyOptionsCtx, (prev) => {
    const handlers: Partial<Handlers> = {
      ...(prev.handlers ?? {}),
      mfUnderline: makeTagHandler("u"),
      mfSubscript: makeTagHandler("sub"),
      mfSuperscript: makeTagHandler("sup"),
    } as Partial<Handlers>;
    return { ...prev, handlers };
  });
};

export const manifestoInlineMarks: MilkdownPlugin[] = [
  manifestoInlineMarksConfig,
  underlineSchema,
  subscriptSchema,
  superscriptSchema,
  toggleUnderlineCommand,
  toggleSubscriptCommand,
  toggleSuperscriptCommand,
].flat();
