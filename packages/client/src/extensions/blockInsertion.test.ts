import { type Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";
import { defined } from "../test/defined.js";
import { insertBlock } from "./blockInsertion.js";

// Node names as Milkdown's presets give them, which is all `insertBlock` reads.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    hr: { group: "block" },
    bullet_list: { group: "block", content: "list_item+" },
    list_item: { content: "paragraph block*" },
  },
});
const paragraph = defined(schema.nodes.paragraph);
const hr = defined(schema.nodes.hr);
const bullet_list = defined(schema.nodes.bullet_list);
const list_item = defined(schema.nodes.list_item);

const p = (text = "") =>
  paragraph.create(null, text ? schema.text(text) : undefined);

/** The document as a line per top-level block, `|` marking the caret. */
function show(state: EditorState): string {
  const caret = state.selection.from;
  const lines: string[] = [];
  state.doc.forEach((node: ProseNode, offset: number) => {
    let text = node.type === hr ? "---" : node.textContent;
    if (
      node.type === paragraph &&
      caret > offset &&
      caret <= offset + node.nodeSize
    ) {
      const at = caret - offset - 1;
      text = `${text.slice(0, at)}|${text.slice(at)}`;
    }
    lines.push(node.type === bullet_list ? `- ${text}` : text);
  });
  return lines.join("\n");
}

function insertDivider(doc: ProseNode, caret: number): string {
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, caret),
  });
  const tr = insertBlock(state, hr.create(), false);
  if (!tr) throw new Error("nothing inserted");
  return show(state.apply(tr));
}

describe("insertBlock", () => {
  it("puts the block after the caret's paragraph, not inside it", () => {
    const doc = schema.node("doc", null, [p("First"), p("Second")]);
    expect(insertDivider(doc, 3)).toBe("First\n---\n|Second");
  });

  it("adds a paragraph to go on in when nothing follows", () => {
    const doc = schema.node("doc", null, [p("Only")]);
    expect(insertDivider(doc, 3)).toBe("Only\n---\n|");
  });

  it("takes the place of an empty paragraph", () => {
    const doc = schema.node("doc", null, [p("Above"), p(), p("Below")]);
    expect(insertDivider(doc, 8)).toBe("Above\n---\n|Below");
  });

  it("goes after a whole list rather than into an item", () => {
    const doc = schema.node("doc", null, [
      bullet_list.create(null, list_item.create(null, p("Milk"))),
    ]);
    expect(insertDivider(doc, 4)).toBe("- Milk\n---\n|");
  });
});
