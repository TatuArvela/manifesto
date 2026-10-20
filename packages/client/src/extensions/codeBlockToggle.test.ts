import { type Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";
import { toggleCodeBlock } from "./codeBlockToggle.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    code_block: { group: "block", content: "text*", code: true },
    bullet_list: { group: "block", content: "list_item+" },
    list_item: { content: "paragraph block*" },
  },
});
const p = (text = "") =>
  schema.node("paragraph", null, text ? schema.text(text) : undefined);
const code = (text: string) =>
  schema.node("code_block", null, schema.text(text));
const doc = (...content: ProseNode[]) => schema.node("doc", null, content);

/** Each top-level block as `type: text`, with code lines joined by `|`. */
function shape(node: ProseNode): string[] {
  const out: string[] = [];
  node.forEach((child) => {
    out.push(`${child.type.name}: ${child.textContent.replace(/\n/g, "|")}`);
  });
  return out;
}

function toggle(d: ProseNode, from: number, to = from) {
  const state = EditorState.create({
    doc: d,
    selection: TextSelection.create(d, from, to),
  });
  const tr = toggleCodeBlock(state);
  return tr ? state.apply(tr) : null;
}

describe("toggleCodeBlock", () => {
  it("makes the selected paragraphs one code block, a line each", () => {
    // From inside "one" to inside "three".
    const next = toggle(doc(p("one"), p("two"), p("three"), p("after")), 2, 13);
    expect(next && shape(next.doc)).toEqual([
      "code_block: one|two|three",
      "paragraph: after",
    ]);
  });

  it("selects the code it made", () => {
    const next = toggle(doc(p("one"), p("two")), 2, 7);
    const selection = next?.selection;
    expect(
      selection && next.doc.textBetween(selection.from, selection.to),
    ).toBe("one\ntwo");
  });

  it("turns the caret's paragraph alone into a code block", () => {
    const next = toggle(doc(p("one"), p("two")), 2);
    expect(next && shape(next.doc)).toEqual([
      "code_block: one",
      "paragraph: two",
    ]);
  });

  it("turns a code block back into a paragraph for each line", () => {
    const next = toggle(doc(code("one\ntwo\n\nfour")), 2);
    expect(next && shape(next.doc)).toEqual([
      "paragraph: one",
      "paragraph: two",
      "paragraph: ",
      "paragraph: four",
    ]);
  });

  it("takes in a whole list when the selection crosses its items", () => {
    const list = schema.node("bullet_list", null, [
      schema.node("list_item", null, [p("a")]),
      schema.node("list_item", null, [p("b")]),
    ]);
    // From inside "a" to inside "b".
    const next = toggle(doc(list), 3, 8);
    expect(next && shape(next.doc)).toEqual(["code_block: a|b"]);
  });
});
