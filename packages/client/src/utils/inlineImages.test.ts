import { describe, expect, it } from "vitest";
import {
  imagePointer,
  markImagePointers,
  pointedImage,
  withoutImagePointer,
} from "./inlineImages.ts";

describe("pointedImage", () => {
  it("reads the index from 0 of a pointer that counts from 1", () => {
    expect(pointedImage(imagePointer(1))).toBe(0);
    expect(pointedImage("image:12")).toBe(11);
  });

  it("is null for all other addresses", () => {
    for (const src of [
      "image:0",
      "image:",
      "image:1x",
      "https://a/b.png",
      "",
    ]) {
      expect(pointedImage(src)).toBeNull();
    }
  });
});

describe("withoutImagePointer", () => {
  it("removes pointers to the removed image and moves later ones down", () => {
    expect(
      withoutImagePointer(
        "a ![](image:1) b ![x](image:2) c ![](image:3) ![](https://e/f.png)",
        1,
      ),
    ).toBe("a ![](image:1) b  c ![](image:2) ![](https://e/f.png)");
  });

  it("returns text with no pointers as it is", () => {
    const text = "no images here";
    expect(withoutImagePointer(text, 0)).toBe(text);
  });
});

describe("markImagePointers", () => {
  it("moves a pointer from src to data-image, and leaves other images", () => {
    const tree = {
      type: "root",
      children: [
        { type: "element", tagName: "img", properties: { src: "image:2" } },
        { type: "element", tagName: "img", properties: { src: "a.png" } },
      ],
    };
    markImagePointers()(tree);
    expect(tree.children[0]?.properties).toEqual({ dataImage: "1" });
    expect(tree.children[1]?.properties).toEqual({ src: "a.png" });
  });
});
