import { describe, expect, it } from "vitest";
import { type AnyNode, pairChildren } from "./pairInlineTags.js";

const html = (value: string): AnyNode => ({ type: "html", value });
const text = (value: string): AnyNode => ({ type: "text", value });

describe("pairChildren", () => {
  it("turns a pair of tags into a mark around what they held", () => {
    expect(
      pairChildren([text("a "), html("<u>"), text("b"), html("</u>")]),
    ).toEqual([text("a "), { type: "mfUnderline", children: [text("b")] }]);
  });

  it("nests a tag inside itself and inside another", () => {
    expect(
      pairChildren([
        html("<u>"),
        html("<U class='x'>"),
        text("a"),
        html("</u>"),
        html("<sup>"),
        text("b"),
        html("</sup>"),
        html("</u >"),
      ]),
    ).toEqual([
      {
        type: "mfUnderline",
        children: [
          { type: "mfUnderline", children: [text("a")] },
          { type: "mfSuperscript", children: [text("b")] },
        ],
      },
    ]);
  });

  it("leaves a tag with no partner, and a pair that crosses another's end", () => {
    const stray = [html("</u>"), html("<sub>"), text("a")];
    expect(pairChildren(stray)).toEqual(stray);
    expect(
      pairChildren([
        html("<u>"),
        html("<sup>"),
        text("a"),
        html("</u>"),
        html("</sup>"),
      ]),
    ).toEqual([
      { type: "mfUnderline", children: [html("<sup>"), text("a")] },
      html("</sup>"),
    ]);
  });

  it("pairs inside the nodes it does not replace", () => {
    expect(
      pairChildren([
        {
          type: "paragraph",
          children: [html("<sub>"), text("2"), html("</sub>")],
        },
      ]),
    ).toEqual([
      {
        type: "paragraph",
        children: [{ type: "mfSubscript", children: [text("2")] }],
      },
    ]);
  });

  it("reads a note of unclosed tags in time that follows its length", () => {
    // 100,000 characters of `<u>`: scanning ahead from each was half a
    // billion tests, tens of seconds.
    const unclosed = Array.from({ length: 33_000 }, () => html("<u>"));
    const started = performance.now();
    expect(pairChildren(unclosed)).toHaveLength(33_000);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("stops nesting marks before the nesting could exhaust the stack", () => {
    const depth = 20_000;
    const nested = [
      ...Array.from({ length: depth }, () => html("<u>")),
      text("a"),
      ...Array.from({ length: depth }, () => html("</u>")),
    ];
    let node: AnyNode | undefined = pairChildren(nested)[0];
    let marks = 0;
    while (node?.type === "mfUnderline") {
      marks++;
      node = node.children?.[0];
    }
    expect(marks).toBe(100);
  });
});
