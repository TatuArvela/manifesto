import { describe, expect, it } from "vitest";
import { placedImageAlts, placeImages } from "./placeImages.ts";

describe("placeImages", () => {
  it("adds after the rest when nothing is replaced", () => {
    expect(placeImages(["a", "b"], ["c"])).toEqual(["a", "b", "c"]);
  });

  it("puts the new image where the one it replaces was", () => {
    expect(placeImages(["a", "b", "c"], ["b2"], "b")).toEqual(["a", "b2", "c"]);
  });

  it("keeps the new image when the one it replaces has gone", () => {
    expect(placeImages(["a", "c"], ["b2"], "b")).toEqual(["a", "c", "b2"]);
  });
});

describe("placedImageAlts", () => {
  const before = { images: ["a", "b", "c"], imageAlts: ["", "Bee", "Sea"] };

  it("keeps each description with its image, and gives a new one none", () => {
    expect(placedImageAlts(before, ["a", "b", "c", "d"], ["d"])).toEqual([
      "",
      "Bee",
      "Sea",
      "",
    ]);
  });

  it("gives a drawing the description of the image it was drawn over", () => {
    expect(placedImageAlts(before, ["a", "b2", "c"], ["b2"], "b")).toEqual([
      "",
      "Bee",
      "Sea",
    ]);
  });

  it("is empty when no image has a description", () => {
    expect(placedImageAlts({ images: ["a"] }, ["a", "b"], ["b"])).toEqual([]);
  });
});
