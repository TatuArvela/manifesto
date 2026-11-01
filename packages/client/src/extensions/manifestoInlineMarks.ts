import { NoteColor, NoteFont } from "@manifesto/shared";
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
  TEXT_COLOR_MDAST,
  TEXT_FONT_MDAST,
} from "./pairInlineTags.ts";

const remarkManifestoInlineMarks: Plugin<[], AnyNode> = () => {
  return (tree) => {
    // One time, from the root. `pairChildren` itself goes all the way down. A
    // second visit to each node to do it again repeated the work at each level.
    if (tree.children) tree.children = pairChildren(tree.children);
  };
};

function makeMarkSchema(
  id: string,
  mdastType: string,
  tag: Exclude<InlineTag, "span">,
) {
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

/**
 * A mark with one attribute that is written as `<span data-<attr>="value">`:
 * the color of text (a `NoteColor`) and its font (a `NoteFont`). Thus, themes
 * give the color in each shade, as they do for a note.
 */
function makeSpanMarkSchema(
  id: string,
  mdastType: string,
  attr: string,
  values: readonly string[],
) {
  const dataAttr = `data-${attr}`;
  return $markSchema(id, () => ({
    attrs: { [attr]: { default: "" } },
    parseDOM: [
      {
        tag: `span[${dataAttr}]`,
        // A paste can bring any value. Only a known one, other than the
        // default, becomes the mark. Thus, the Markdown never gets a value
        // that the parser refuses.
        getAttrs: (dom) => {
          const value = (dom as HTMLElement).getAttribute(dataAttr) ?? "";
          return values.includes(value) && value !== "default"
            ? { [attr]: value }
            : false;
        },
      },
    ],
    toDOM: (mark) =>
      ["span", { [dataAttr]: mark.attrs[attr] as string }, 0] as [
        string,
        Record<string, string>,
        0,
      ],
    parseMarkdown: {
      match: (node) => node.type === mdastType,
      runner: (state, node, markType) => {
        const attrs = (node as { attrs?: Record<string, string> }).attrs;
        state.openMark(markType, { [attr]: attrs?.[attr] ?? "" });
        state.next(node.children ?? []);
        state.closeMark(markType);
      },
    },
    toMarkdown: {
      match: (mark) => mark.type.name === id,
      runner: (state, mark) => {
        state.withMark(mark, mdastType, undefined, {
          attrs: { [attr]: mark.attrs[attr] as string },
        });
      },
    },
  }));
}

export const textColorSchema = makeSpanMarkSchema(
  "textColor",
  TEXT_COLOR_MDAST,
  "color",
  Object.values(NoteColor),
);
export const textFontSchema = makeSpanMarkSchema(
  "textFont",
  TEXT_FONT_MDAST,
  "font",
  Object.values(NoteFont),
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

function makeSpanHandler(attr: string): Handle {
  return (node, _parent, state, info) => {
    const content = state.containerPhrasing(
      node as unknown as Parameters<typeof state.containerPhrasing>[0],
      info,
    );
    const value = (node as unknown as AnyNode).attrs?.[attr] ?? "";
    return `<span data-${attr}="${value}">${content}</span>`;
  };
}

function makeTagHandler(tag: Exclude<InlineTag, "span">): Handle {
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
      [TEXT_COLOR_MDAST]: makeSpanHandler("color"),
      [TEXT_FONT_MDAST]: makeSpanHandler("font"),
    } as Partial<Handlers>;
    return { ...prev, handlers };
  });
};

export const manifestoInlineMarks: MilkdownPlugin[] = [
  manifestoInlineMarksConfig,
  underlineSchema,
  subscriptSchema,
  superscriptSchema,
  textColorSchema,
  textFontSchema,
  toggleUnderlineCommand,
  toggleSubscriptCommand,
  toggleSuperscriptCommand,
].flat();
