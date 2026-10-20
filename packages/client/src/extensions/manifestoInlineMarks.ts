import {
  remarkPluginsCtx,
  remarkStringifyOptionsCtx,
} from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { $command, $markSchema } from "@milkdown/kit/utils";
import type { Handle, Handlers } from "mdast-util-to-markdown";
import type { Plugin } from "unified";
import {
  type AnyNode,
  type InlineTag,
  pairChildren,
} from "./pairInlineTags.ts";

const remarkManifestoInlineMarks: Plugin<[], AnyNode> = () => {
  return (tree) => {
    // One time, from the root. `pairChildren` itself goes all the way down. A
    // second visit to each node to do it again repeated the work at each level.
    if (tree.children) tree.children = pairChildren(tree.children);
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
