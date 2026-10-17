import { type Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import {
  EditorState,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";
import { type ListKind, toggleList } from "./listToggle.ts";

// The list nodes as Milkdown's presets have them: an item knows its own
// `listType` and `label`, and a task is an item whose `checked` is set.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    hardbreak: { group: "inline", inline: true },
    paragraph: { group: "block", content: "inline*" },
    bullet_list: { group: "block", content: "list_item+" },
    ordered_list: { group: "block", content: "list_item+" },
    list_item: {
      content: "paragraph block*",
      attrs: {
        checked: { default: null },
        listType: { default: "bullet" },
        label: { default: "•" },
      },
    },
  },
});

/** Each text block as a line: its marker, indented two spaces per level. */
function outline(doc: ProseNode): string[] {
  const lines: string[] = [];
  const walk = (node: ProseNode, depth: number, marker: string) => {
    node.forEach((child) => {
      if (child.type.name === "paragraph") {
        const text = child.textContent;
        lines.push(`${"  ".repeat(Math.max(0, depth - 1))}${marker}${text}`);
        marker = depth > 0 ? "  " : "";
      } else if (child.type.name.endsWith("_list")) {
        child.forEach((item) => {
          const task =
            item.attrs.checked == null
              ? ""
              : item.attrs.checked
                ? "[x] "
                : "[ ] ";
          const mark = child.type.name === "ordered_list" ? "1. " : "- ";
          walk(item, depth + 1, `${mark}${task}`);
        });
      }
    });
  };
  walk(doc, 0, "");
  return lines;
}

/** Builds paragraphs (and hard breaks) from text, `\n\n` and `\n`. */
function paragraphs(text: string): ProseNode[] {
  return text.split("\n\n").map((para) => {
    const parts: ProseNode[] = [];
    para.split("\n").forEach((line, i) => {
      if (i > 0) parts.push(schema.node("hardbreak"));
      if (line) parts.push(schema.text(line));
    });
    return schema.node("paragraph", null, parts);
  });
}

function view(doc: ProseNode, from: string, to = from) {
  const at = (needle: string) => {
    let pos = -1;
    doc.descendants((node, p) => {
      if (pos === -1 && node.isText && node.text?.includes(needle)) {
        pos = p + (node.text?.indexOf(needle) ?? 0);
      }
      return pos === -1;
    });
    return pos;
  };
  const target = {
    state: EditorState.create({
      doc,
      selection: TextSelection.create(doc, at(from), at(to) + to.length),
    }),
    dispatch(tr: Transaction) {
      target.state = target.state.apply(tr);
    },
  };
  return target;
}

function press(v: ReturnType<typeof view>, ...kinds: ListKind[]) {
  for (const kind of kinds) toggleList(v, kind);
  return outline(v.state.doc);
}

const doc = (...content: ProseNode[]) => schema.node("doc", null, content);
const item = (
  text: string,
  attrs: Record<string, unknown> = {},
  ...rest: ProseNode[]
) =>
  schema.node("list_item", attrs, [
    schema.node("paragraph", null, schema.text(text)),
    ...rest,
  ]);

describe("toggleList", () => {
  const three = () => doc(...paragraphs("One\n\nTwo\n\nThree"));

  it("makes each selected paragraph an item of its own", () => {
    expect(press(view(three(), "One", "Three"), "bullet")).toEqual([
      "- One",
      "- Two",
      "- Three",
    ]);
    expect(press(view(three(), "One", "Three"), "task")).toEqual([
      "- [ ] One",
      "- [ ] Two",
      "- [ ] Three",
    ]);
  });

  it("makes each line of a paragraph an item of its own", () => {
    const lines = doc(...paragraphs("One\nTwo\nThree"));
    expect(press(view(lines, "One", "Three"), "ordered")).toEqual([
      "1. One",
      "1. Two",
      "1. Three",
    ]);
  });

  it("takes the list off when pressed again, for every kind", () => {
    for (const kind of ["bullet", "ordered", "task"] as const) {
      expect(press(view(three(), "One", "Three"), kind, kind)).toEqual([
        "One",
        "Two",
        "Three",
      ]);
    }
  });

  it("changes the list's kind when the items are of another", () => {
    expect(press(view(three(), "One", "Three"), "bullet", "ordered")).toEqual([
      "1. One",
      "1. Two",
      "1. Three",
    ]);
    expect(press(view(three(), "One", "Three"), "ordered", "task")).toEqual([
      "- [ ] One",
      "- [ ] Two",
      "- [ ] Three",
    ]);
    expect(press(view(three(), "One", "Three"), "task", "bullet")).toEqual([
      "- One",
      "- Two",
      "- Three",
    ]);
  });

  it("keeps a ticked task ticked when the rest become tasks", () => {
    const mixed = doc(
      schema.node("bullet_list", null, [
        item("Done", { checked: true }),
        item("Todo"),
      ]),
    );
    expect(press(view(mixed, "Done", "Todo"), "task")).toEqual([
      "- [x] Done",
      "- [ ] Todo",
    ]);
  });

  it("makes one list of a selection half in a list", () => {
    const half = doc(
      schema.node("bullet_list", null, [item("One")]),
      ...paragraphs("Two"),
    );
    expect(press(view(half, "One", "Two"), "bullet")).toEqual([
      "- One",
      "- Two",
    ]);
  });

  it("takes a nested item out to a line after the list", () => {
    const nested = doc(
      schema.node("bullet_list", null, [
        item("One", {}, schema.node("bullet_list", null, [item("Two")])),
      ]),
    );
    expect(press(view(nested, "Two"), "bullet")).toEqual(["- One", "Two"]);
  });
});
