import { type Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";
import { unquote } from "./richFormatting.js";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    blockquote: { group: "block", content: "block+" },
  },
});
const p = (text: string) =>
  schema.node("paragraph", null, text ? schema.text(text) : undefined);
const quote = (...content: ProseNode[]) =>
  schema.node("blockquote", null, content);

/** The document's top-level shape: `>` per quote level before each text. */
function shape(doc: ProseNode): string[] {
  const lines: string[] = [];
  const walk = (node: ProseNode, depth: number) => {
    node.forEach((child) => {
      if (child.type.name === "blockquote") walk(child, depth + 1);
      else lines.push(`${"> ".repeat(depth)}${child.textContent}`);
    });
  };
  walk(doc, 0);
  return lines;
}

function unquoteAt(doc: ProseNode, from: number, to = from) {
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, from, to),
  });
  const tr = unquote(state);
  return tr ? shape(state.apply(tr).doc) : null;
}

describe("unquote", () => {
  it("takes a quoted paragraph out of its quote", () => {
    expect(unquoteAt(schema.node("doc", null, [quote(p("Said"))]), 3)).toEqual([
      "Said",
    ]);
  });

  it("takes one level off a quote inside a quote", () => {
    const doc = schema.node("doc", null, [quote(quote(p("Deep")))]);
    expect(unquoteAt(doc, 4)).toEqual(["> Deep"]);
  });

  it("takes out only the selected paragraphs, splitting the quote", () => {
    const doc = schema.node("doc", null, [
      quote(p("One"), p("Two"), p("Three")),
    ]);
    // The caret in "Two": 1 (into the quote) + 5 ("One") + 1 (into "Two").
    expect(unquoteAt(doc, 8)).toEqual(["> One", "Two", "> Three"]);
  });

  it("stops at the quote's end when the selection runs on past it", () => {
    const doc = schema.node("doc", null, [quote(p("Said")), p(""), p("After")]);
    // From the start of "Said" into the empty paragraph after the quote.
    expect(unquoteAt(doc, 2, 9)).toEqual(["Said", "", "After"]);
  });

  it("takes out the rest of a quote selected from its middle onwards", () => {
    const doc = schema.node("doc", null, [
      quote(p("One"), p("Two")),
      p("After"),
    ]);
    // From inside "One" to inside "After".
    expect(unquoteAt(doc, 3, 14)).toEqual(["One", "Two", "After"]);
  });

  it("ignores a start at the end of the line above the quote", () => {
    const doc = schema.node("doc", null, [p("Above"), quote(p("Said"))]);
    // From the end of "Above" (6) to the end of "Said" (13).
    expect(unquoteAt(doc, 6, 13)).toEqual(["Above", "Said"]);
  });

  it("does nothing outside a quote", () => {
    expect(unquoteAt(schema.node("doc", null, [p("Plain")]), 2)).toBeNull();
  });
});
