import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";
import { placeImagePointer, removeImagePointers } from "./imagePointers.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    image: {
      group: "inline",
      inline: true,
      attrs: { src: {}, alt: { default: "" } },
    },
  },
});
const image = (src: string) => schema.node("image", { src });

/** The `src` of each image, in order. */
function sources(state: EditorState): string[] {
  const found: string[] = [];
  state.doc.descendants((node) => {
    if (node.type.name === "image") found.push(String(node.attrs.src));
  });
  return found;
}

describe("removeImagePointers", () => {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("a"),
      image("image:1"),
      image("image:2"),
      image("https://example.com/x.png"),
      image("image:3"),
      image("image:2"),
    ]),
  ]);
  const state = EditorState.create({ doc });

  it("takes out each pointer to the image, and moves later ones down", () => {
    const tr = removeImagePointers(state, 1);
    expect(tr).not.toBeNull();
    expect(sources(state.apply(tr as never))).toEqual([
      "image:1",
      "https://example.com/x.png",
      "image:2",
    ]);
  });

  it("only takes the image out of the text when it stays in the note", () => {
    const tr = removeImagePointers(state, 1, false);
    expect(sources(state.apply(tr as never))).toEqual([
      "image:1",
      "https://example.com/x.png",
      "image:3",
    ]);
  });

  it("does nothing when no pointer is at or after the image", () => {
    expect(removeImagePointers(state, 5)).toBeNull();
  });
});

describe("placeImagePointer", () => {
  it("puts a pointer that counts from 1 at the position", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("ab")]),
    ]);
    const state = EditorState.create({ doc });
    const tr = placeImagePointer(state, 2, 0);
    const placed = state.apply(tr as never);
    expect(sources(placed)).toEqual(["image:1"]);
    expect(placed.doc.textContent).toBe("ab");
    expect(placed.doc.firstChild?.child(1).type.name).toBe("image");
  });
});
