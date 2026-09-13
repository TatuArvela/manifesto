import { describe, expect, it } from "vitest";
import { decodeHtml, extractMetadata } from "./parseHtml.js";

const PAGE = new URL("https://example.com/articles/one");

describe("extractMetadata", () => {
  it("prefers Open Graph over Twitter cards over the plain tags", () => {
    const html = `<html><head>
      <title>Plain title</title>
      <meta name="description" content="Plain description">
      <meta name="twitter:title" content="Twitter title">
      <meta property="og:title" content="OG title">
      <meta property="og:description" content="OG description">
      <meta name="twitter:image" content="https://cdn.example.com/tw.png">
      <meta property="og:image" content="https://cdn.example.com/og.png">
    </head><body></body></html>`;
    expect(extractMetadata(html, PAGE)).toEqual({
      title: "OG title",
      description: "OG description",
      image: "https://cdn.example.com/og.png",
      favicon: "https://example.com/favicon.ico",
    });
  });

  it("falls back to the title tag and meta description", () => {
    const html = `<head><title>
      Just a   title
    </title><meta name="description" content="Words"></head>`;
    const meta = extractMetadata(html, PAGE);
    expect(meta.title).toBe("Just a title");
    expect(meta.description).toBe("Words");
    expect(meta.image).toBeUndefined();
  });

  it("decodes entities in attributes and the title", () => {
    const html = `<head><title>Tom &amp; Jerry &#169; &#x27;classic&#x27;</title>
      <meta property="og:description" content="&quot;Quoted&quot; &lt;b&gt;"></head>`;
    const meta = extractMetadata(html, PAGE);
    expect(meta.title).toBe("Tom & Jerry © 'classic'");
    expect(meta.description).toBe('"Quoted" <b>');
  });

  it("resolves relative image and icon URLs against the page", () => {
    const html = `<head>
      <meta property="og:image" content="/img/cover.jpg">
      <link rel="shortcut icon" href="icons/fav.png">
    </head>`;
    const meta = extractMetadata(html, PAGE);
    expect(meta.image).toBe("https://example.com/img/cover.jpg");
    expect(meta.favicon).toBe("https://example.com/articles/icons/fav.png");
  });

  it("resolves against a base element when the page has one", () => {
    const html = `<head><base href="https://static.example.net/app/">
      <meta property="og:image" content="cover.jpg"></head>`;
    expect(extractMetadata(html, PAGE).image).toBe(
      "https://static.example.net/app/cover.jpg",
    );
  });

  it("uses an apple-touch-icon only when there is no icon", () => {
    expect(
      extractMetadata(
        `<head><link rel="apple-touch-icon" href="/touch.png"></head>`,
        PAGE,
      ).favicon,
    ).toBe("https://example.com/touch.png");
    expect(
      extractMetadata(
        `<head><link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/icon.png"></head>`,
        PAGE,
      ).favicon,
    ).toBe("https://example.com/icon.png");
  });

  it("ignores image URLs that are not http(s)", () => {
    const html = `<head>
      <meta property="og:image" content="javascript:alert(1)">
      <meta name="twitter:image" content="data:image/png;base64,AAAA">
      <link rel="icon" href="file:///etc/passwd">
    </head>`;
    const meta = extractMetadata(html, PAGE);
    expect(meta.image).toBeUndefined();
    expect(meta.favicon).toBe("https://example.com/favicon.ico");
  });

  it("does not read tags from the body", () => {
    const html = `<head><title>Head</title></head><body>
      <meta property="og:title" content="Body"></body>`;
    expect(extractMetadata(html, PAGE).title).toBe("Head");
  });

  it("handles unquoted and single-quoted attributes", () => {
    const html = `<head><meta property=og:title content='Single'>
      <meta property=og:image content=/a.png></head>`;
    const meta = extractMetadata(html, PAGE);
    expect(meta.title).toBe("Single");
    expect(meta.image).toBe("https://example.com/a.png");
  });

  it("stays fast on a page built to make a regex backtrack", () => {
    const html = `<head>${"<meta ".repeat(100_000)}${"a=".repeat(50_000)}`;
    const started = performance.now();
    extractMetadata(html, PAGE);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("decodeHtml", () => {
  it("uses the charset from the Content-Type header", () => {
    const body = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "café" in Latin-1
    expect(decodeHtml(body, "text/html; charset=ISO-8859-1")).toBe("café");
  });

  it("falls back to a meta charset, then to UTF-8", () => {
    const latin1 = Buffer.concat([
      Buffer.from('<meta charset="windows-1252"><title>'),
      Buffer.from([0xe9]),
    ]);
    expect(decodeHtml(latin1, "text/html")).toContain("<title>é");
    expect(decodeHtml(Buffer.from("héllo", "utf8"), "text/html")).toBe("héllo");
  });

  it("ignores a charset label it does not know", () => {
    expect(
      decodeHtml(Buffer.from("plain", "utf8"), "text/html; charset=bogus"),
    ).toBe("plain");
  });
});
