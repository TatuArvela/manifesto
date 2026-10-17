import { type Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import { EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";
import { setItemDate } from "./itemDates.js";

// The list nodes as Milkdown's presets have them: a task is an item whose
// `checked` is set. `code` is the inline code mark, which quotes a token.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    bullet_list: { group: "block", content: "list_item+" },
    list_item: {
      content: "paragraph block*",
      attrs: { checked: { default: null } },
    },
  },
  marks: { inlineCode: { code: true } },
});

const p = (text: string) =>
  schema.node("paragraph", null, text ? [schema.text(text)] : []);
const task = (text: string, ...rest: ProseNode[]) =>
  schema.node("list_item", { checked: false }, [p(text), ...rest]);
const list = (...items: ProseNode[]) => schema.node("bullet_list", null, items);

/** A state with the caret in the first text block holding `at`. */
function stateWith(doc: ProseNode, at: string): EditorState {
  let pos = -1;
  doc.descendants((node, offset) => {
    if (pos === -1 && node.type.name === "paragraph") {
      if (node.textContent.includes(at)) pos = offset + 1;
    }
    return pos === -1;
  });
  const state = EditorState.create({ doc });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, pos)));
}

/** The text of each paragraph, after `setItemDate` has run. */
function dated(state: EditorState, date: string): string[] | null {
  let result: string[] | null = null;
  setItemDate(state, date, (tr) => {
    const lines: string[] = [];
    tr.doc.descendants((node) => {
      if (node.type.name === "paragraph") lines.push(node.textContent);
      return true;
    });
    result = lines;
  });
  return result;
}

describe("setItemDate", () => {
  it("adds a date at the end of the item's line, a space from its text", () => {
    const state = stateWith(
      schema.node("doc", null, [list(task("Milk"))]),
      "Milk",
    );
    expect(dated(state, "2026-10-02")).toEqual(["Milk @2026-10-02"]);
  });

  it("adds no space to an empty item, or one that ends with a space", () => {
    const empty = stateWith(schema.node("doc", null, [list(task(""))]), "");
    expect(dated(empty, "2026-10-02")).toEqual(["@2026-10-02"]);
    const spaced = stateWith(
      schema.node("doc", null, [list(task("Milk "))]),
      "Milk",
    );
    expect(dated(spaced, "2026-10-02")).toEqual(["Milk @2026-10-02"]);
  });

  it("replaces the date the item had, where it was", () => {
    const state = stateWith(
      schema.node("doc", null, [list(task("Call @2026-01-05 Ann"))]),
      "Call",
    );
    expect(dated(state, "2026-10-02")).toEqual(["Call @2026-10-02 Ann"]);
  });

  it("dates the item the caret is in, not the one around it", () => {
    const state = stateWith(
      schema.node("doc", null, [list(task("Trip", list(task("Tickets"))))]),
      "Tickets",
    );
    expect(dated(state, "2026-10-02")).toEqual(["Trip", "Tickets @2026-10-02"]);
  });

  it("writes the token as plain text, never inside a code mark", () => {
    const code = schema.text("npm", [schema.mark("inlineCode")]);
    const doc = schema.node("doc", null, [
      list(
        schema.node("list_item", { checked: false }, [
          schema.node("paragraph", null, [code]),
        ]),
      ),
    ]);
    const state = stateWith(doc, "npm");
    let marked = true;
    setItemDate(state, "2026-10-02", (tr) => {
      tr.doc.descendants((node) => {
        if (node.isText && node.text?.includes("@"))
          marked = node.marks.length > 0;
        return true;
      });
    });
    expect(marked).toBe(false);
  });

  it("refuses outside a checklist, and a day that does not exist", () => {
    const plain = stateWith(schema.node("doc", null, [p("Text")]), "Text");
    expect(setItemDate(plain, "2026-10-02")).toBe(false);
    const item = stateWith(
      schema.node("doc", null, [list(task("Milk"))]),
      "Milk",
    );
    expect(setItemDate(item, "2026-02-30")).toBe(false);
    expect(setItemDate(item, "2026-10-02")).toBe(true);
  });
});
