import {
  MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES,
  MAX_LINK_PREVIEW_URL_LENGTH,
  MAX_LINK_PREVIEWS_PER_NOTE,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import {
  appendStubPreviews,
  extractUrls,
  makeStubPreview,
  normalizeDomain,
  parseLinkPreviews,
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

describe("extractUrls performance", () => {
  it("does not backtrack quadratically on a long punctuation run", () => {
    // An unbounded `+` in TRAILING_PUNCTUATION_RE took ~15s here; this runs in
    // well under a millisecond. `extractUrls` is called during note-card render,
    // so a pathological note would otherwise freeze the tab on every paint.
    const hostile = `http://x${".".repeat(120_000)}a`;
    const started = performance.now();
    extractUrls(hostile);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("still strips a normal run of trailing punctuation", () => {
    expect(extractUrls("see https://example.com...")).toEqual([
      "https://example.com",
    ]);
  });
});

describe("appendStubPreviews", () => {
  const stub = (url: string) => makeStubPreview(url);

  it("adds a card for every URL of a paste in one list", () => {
    const result = appendStubPreviews(
      [stub("https://a.test")],
      ["https://b.test", "https://c.test"],
    );
    expect(result.previews.map((p) => p.url)).toEqual([
      "https://a.test",
      "https://b.test",
      "https://c.test",
    ]);
    expect(result.added).toEqual(["https://b.test", "https://c.test"]);
    expect(result.overflow).toBe(false);
  });

  it("skips URLs already on the note or repeated in the paste", () => {
    const result = appendStubPreviews(
      [stub("https://a.test")],
      ["https://a.test", "https://b.test", "https://b.test"],
    );
    expect(result.added).toEqual(["https://b.test"]);
  });

  it("skips URLs the server would refuse", () => {
    const long = `https://a.test/${"x".repeat(MAX_LINK_PREVIEW_URL_LENGTH)}`;
    expect(appendStubPreviews([], [long, "https://"]).added).toEqual([]);
  });

  it("stops at the per-note cap and says so", () => {
    const full = Array.from(
      { length: MAX_LINK_PREVIEWS_PER_NOTE - 1 },
      (_, i) => stub(`https://${i}.test`),
    );
    const result = appendStubPreviews(full, [
      "https://last.test",
      "https://over.test",
    ]);
    expect(result.added).toEqual(["https://last.test"]);
    expect(result.previews).toHaveLength(MAX_LINK_PREVIEWS_PER_NOTE);
    expect(result.overflow).toBe(true);
  });

  it("does not report overflow when every extra URL was a duplicate", () => {
    const full = Array.from({ length: MAX_LINK_PREVIEWS_PER_NOTE }, (_, i) =>
      stub(`https://${i}.test`),
    );
    expect(appendStubPreviews(full, ["https://0.test"]).overflow).toBe(false);
  });
});

describe("parseLinkPreviews", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  it("keeps a well-formed preview as it is", () => {
    const preview = {
      url: "https://a.test/x",
      title: "A",
      description: "About A",
      image: PNG,
      favicon: PNG,
      domain: "a.test",
    };
    expect(parseLinkPreviews([preview])).toEqual([preview]);
  });

  it("drops a preview whose URL is not http(s)", () => {
    expect(
      parseLinkPreviews([
        { url: "javascript:alert(1)", title: "x", domain: "x" },
        { url: "data:text/html,<script>", title: "x", domain: "x" },
        { title: "no url" },
        "https://not-an-object.test",
        null,
      ]),
    ).toEqual([]);
  });

  it("fills in a missing title and domain from the URL", () => {
    expect(parseLinkPreviews([{ url: "https://www.a.test/p" }])).toEqual([
      {
        url: "https://www.a.test/p",
        title: "https://www.a.test/p",
        domain: "www.a.test",
      },
    ]);
  });

  it("drops remote, scripted and oversized images but keeps the card", () => {
    const oversized = `data:image/png;base64,${"A".repeat(
      MAX_LINK_PREVIEW_IMAGE_DATA_URL_BYTES,
    )}`;
    expect(
      parseLinkPreviews([
        {
          url: "https://a.test",
          title: "A",
          domain: "a.test",
          image: "https://tracker.test/pixel.png",
          favicon: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        },
        {
          url: "https://b.test",
          title: "B",
          domain: "b.test",
          image: oversized,
        },
      ]),
    ).toEqual([
      { url: "https://a.test", title: "A", domain: "a.test" },
      { url: "https://b.test", title: "B", domain: "b.test" },
    ]);
  });

  it("drops duplicates and stops at the per-note cap", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      url: `https://${i % 25}.test`,
    }));
    const parsed = parseLinkPreviews(many);
    expect(parsed).toHaveLength(MAX_LINK_PREVIEWS_PER_NOTE);
    expect(new Set(parsed.map((p) => p.url)).size).toBe(parsed.length);
  });

  it("reads anything but an array as no previews", () => {
    expect(parseLinkPreviews({ url: "https://a.test" })).toEqual([]);
    expect(parseLinkPreviews(undefined)).toEqual([]);
  });
});
