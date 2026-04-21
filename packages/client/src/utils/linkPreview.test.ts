import { describe, expect, it } from "vitest";
import {
  extractUrls,
  makeStubPreview,
  normalizeDomain,
} from "./linkPreview.js";

describe("extractUrls", () => {
  it("returns urls from plain text", () => {
    expect(extractUrls("see https://example.com now")).toEqual([
      "https://example.com",
    ]);
  });

  it("strips trailing punctuation", () => {
    expect(extractUrls("visit https://example.com, please.")).toEqual([
      "https://example.com",
    ]);
    expect(extractUrls("(https://example.com)")).toEqual([
      "https://example.com",
    ]);
  });

  it("deduplicates repeated urls", () => {
    expect(extractUrls("https://a.test https://a.test")).toEqual([
      "https://a.test",
    ]);
  });

  it("returns multiple distinct urls in order", () => {
    expect(
      extractUrls(
        "first http://a.test then https://b.test/x and https://b.test/x",
      ),
    ).toEqual(["http://a.test", "https://b.test/x"]);
  });

  it("returns empty for no urls", () => {
    expect(extractUrls("no links here")).toEqual([]);
    expect(extractUrls("")).toEqual([]);
  });
});

describe("normalizeDomain", () => {
  it("returns host for valid urls", () => {
    expect(normalizeDomain("https://www.example.com/path?x=1")).toBe(
      "www.example.com",
    );
  });

  it("falls back gracefully for invalid urls", () => {
    expect(normalizeDomain("not a url")).toBe("not a url");
  });
});

describe("makeStubPreview", () => {
  it("builds a stub with domain and url-as-title", () => {
    expect(makeStubPreview("https://www.example.com/x")).toEqual({
      url: "https://www.example.com/x",
      title: "https://www.example.com/x",
      domain: "www.example.com",
    });
  });
});
