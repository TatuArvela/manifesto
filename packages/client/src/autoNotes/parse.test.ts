import { describe, expect, it } from "vitest";
import { extractPluginTitle, MissingTitleError } from "./parse.js";

describe("extractPluginTitle", () => {
  it("reads the title from the first line", () => {
    expect(
      extractPluginTitle("// @title Mail delivery\n_default = () => {};"),
    ).toBe("Mail delivery");
  });

  it("skips leading blank lines", () => {
    expect(extractPluginTitle("\n\n// @title Year progress\ncode()")).toBe(
      "Year progress",
    );
  });

  it("tolerates extra whitespace around the directive", () => {
    expect(extractPluginTitle("  //   @title   Trash pickup   \n")).toBe(
      "Trash pickup",
    );
  });

  it("throws when the first non-empty line is not a @title comment", () => {
    expect(() =>
      extractPluginTitle("// Not a title\n_default = () => {};"),
    ).toThrow(MissingTitleError);
  });

  it("throws when the source is empty", () => {
    expect(() => extractPluginTitle("   \n\n")).toThrow(MissingTitleError);
  });

  it("throws when the first non-empty line is code", () => {
    expect(() => extractPluginTitle("_default = () => ({});")).toThrow(
      MissingTitleError,
    );
  });
});
