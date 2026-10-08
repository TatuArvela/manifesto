import { describe, expect, it } from "vitest";
import {
  extractPluginReads,
  extractPluginTitle,
  MAX_READ_TAGS,
  MissingTitleError,
} from "./parse.js";

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

describe("extractPluginReads", () => {
  it("is empty for a plugin that asks for nothing", () => {
    expect(extractPluginReads("// @title T\n_default = () => []")).toEqual([]);
  });

  it("reads a nested tag as it is stored", () => {
    expect(
      extractPluginReads("// @title T\n// @reads Work / Clients/, #a//b"),
    ).toEqual(["work/clients", "a/b"]);
  });

  it("reads the tags from the header, normalized, each once", () => {
    const source = [
      "// @title Open tasks",
      "// @reads Todo, #work",
      "",
      "// @reads  todo ,errands",
      "_default = () => [];",
    ].join("\n");
    expect(extractPluginReads(source)).toEqual(["todo", "work", "errands"]);
  });

  it("ignores a directive past the header, where code could hide one", () => {
    const source = [
      "// @title T",
      "_default = () => [];",
      "// @reads private",
    ].join("\n");
    expect(extractPluginReads(source)).toEqual([]);
  });

  it("takes no more tags than a plugin may ask for", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`).join(", ");
    expect(extractPluginReads(`// @title T\n// @reads ${many}`)).toHaveLength(
      MAX_READ_TAGS,
    );
  });
});
