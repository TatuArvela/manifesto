import { Editor, Extension } from "@tiptap/core";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { describe, expect, it } from "vitest";
import { TaskItemDraggable } from "../extensions/TaskItemDraggable.js";
import { getMarkdown } from "./TiptapEditor.js";

const ParagraphPreserveEmpty = Extension.create({
  name: "paragraphPreserveEmpty",
  priority: 10,
  onBeforeCreate() {
    // biome-ignore lint/suspicious/noExplicitAny: tiptap internals
    const para = this.editor.extensionManager.extensions.find((e: any) => e.name === "paragraph") as any;
    console.log("found paragraph ext?", !!para, "storage:", JSON.stringify(para?.storage?.markdown ? Object.keys(para.storage.markdown) : null));
    if (!para) return;
    const existing = para.storage?.markdown ?? {};
    const orig = existing.serialize;
    if (!para.storage) para.storage = {};
    para.storage.markdown = {
      ...existing,
      // biome-ignore lint/suspicious/noExplicitAny: tiptap internals
      serialize(state: any, node: any) {
        console.log("serializing para, content.size=", node.content.size);
        if (node.content.size === 0) {
          state.write("<p></p>");
          state.closeBlock(node);
          return;
        }
        if (orig) orig.call(this, state, node);
        else { state.renderInline(node); state.closeBlock(node); }
      },
    };
    console.log("after override, storage:", Object.keys(para.storage.markdown));
  },
});

const TaskListTight = Extension.create({
  name: "taskListTight",
  addGlobalAttributes() {
    return [{
      types: ["taskList"],
      attributes: {
        tight: {
          default: true,
          parseHTML: (el: HTMLElement) => el.getAttribute("data-tight") === "true" || !el.querySelector("p"),
          renderHTML: (attrs: { tight: boolean }) => ({ "data-tight": attrs.tight ? "true" : null }),
        },
      },
    }];
  },
});

const exts = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, link: { openOnClick: false } }),
  Subscript,
  Superscript,
  TaskList,
  TaskItemDraggable.configure({ nested: true, onReadOnlyChecked: () => true }),
  TaskListTight,
  ParagraphPreserveEmpty,
  Markdown.configure({ html: true, transformPastedText: true }),
];

describe("empty paragraph preservation", () => {
  it("round-trips", () => {
    const el = document.createElement("div");
    const editor = new Editor({
      element: el,
      extensions: exts,
      content: {
        type: "doc",
        content: [
          { type: "taskList", attrs: { tight: true }, content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }] },
          { type: "paragraph" },
          { type: "bulletList", attrs: { tight: true }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] }] },
        ],
      } as unknown as string,
    });

    const md1 = getMarkdown(editor);
    console.log("md1:", JSON.stringify(md1));
    editor.destroy();
  });
});
