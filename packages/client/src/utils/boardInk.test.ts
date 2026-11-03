import { describe, expect, it } from "vitest";
import { inkHex } from "./boardInk.ts";

describe("inkHex", () => {
  it("names a picked colour as the hex the layer is filled with", () => {
    expect(inkHex("white", "#123456")).toBe("#ffffff");
    expect(inkHex("blue", "#123456")).toBe("#3b82f6");
    expect(inkHex("custom", "#123456")).toBe("#123456");
  });
});
