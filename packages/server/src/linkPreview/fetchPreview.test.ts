import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLinkPreviewFetcher,
  type FetchPolicy,
  sniffImageType,
} from "./fetchPreview.js";

// A 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let server: Server | null = null;

async function serve(handler: RequestListener): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.closeAllConnections();
    server.close(() => resolve());
  });
  server = null;
});

const LOCAL: FetchPolicy = {
  isAllowedAddress: (address) => address === "127.0.0.1",
  allowAnyPort: true,
};

describe("createLinkPreviewFetcher", () => {
  it("builds a preview with the image and favicon inlined", async () => {
    const base = await serve((req, res) => {
      if (req.url === "/cover.png" || req.url === "/favicon.ico") {
        // Served with a wrong type on purpose: the bytes decide.
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(PNG);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<head>
        <meta property="og:title" content="A page">
        <meta property="og:description" content="About things">
        <meta property="og:image" content="/cover.png">
      </head>`);
    });
    const preview = await createLinkPreviewFetcher(LOCAL)(`${base}/post`);
    const inlined = `data:image/png;base64,${PNG.toString("base64")}`;
    expect(preview).toEqual({
      url: `${base}/post`,
      title: "A page",
      description: "About things",
      image: inlined,
      favicon: inlined,
      domain: new URL(base).host,
    });
  });

  it("leaves out an image that is not an image", async () => {
    const base = await serve((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<head><title>T</title>
          <meta property="og:image" content="/fake.png"></head>`);
        return;
      }
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end("<html><script>alert(1)</script></html>");
    });
    const preview = await createLinkPreviewFetcher(LOCAL)(`${base}/`);
    expect(preview?.title).toBe("T");
    expect(preview?.image).toBeUndefined();
    expect(preview?.favicon).toBeUndefined();
  });

  it("uses the URL as the title when the page has none", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<p>no head at all</p>");
    });
    const preview = await createLinkPreviewFetcher(LOCAL)(`${base}/x`);
    expect(preview?.title).toBe(`${base}/x`);
  });

  it("resolves to null for a page that is not HTML or cannot be had", async () => {
    const base = await serve((req, res) => {
      if (req.url === "/file.pdf") {
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end("%PDF-1.7");
        return;
      }
      res.writeHead(500);
      res.end();
    });
    const fetcher = createLinkPreviewFetcher(LOCAL);
    expect(await fetcher(`${base}/file.pdf`)).toBeNull();
    expect(await fetcher(`${base}/broken`)).toBeNull();
    expect(
      await createLinkPreviewFetcher()("http://127.0.0.1/private"),
    ).toBeNull();
  });
});

describe("sniffImageType", () => {
  const pad = (bytes: number[] | string) =>
    Buffer.concat([
      typeof bytes === "string"
        ? Buffer.from(bytes, "latin1")
        : Buffer.from(bytes),
      Buffer.alloc(16),
    ]);

  it("recognizes the accepted formats by their magic bytes", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(pad("GIF89a"))).toBe("image/gif");
    expect(sniffImageType(pad("RIFF\0\0\0\0WEBP"))).toBe("image/webp");
    expect(sniffImageType(pad("\0\0\0\x1cftypavif"))).toBe("image/avif");
    expect(sniffImageType(pad([0, 0, 1, 0, 1, 0]))).toBe("image/x-icon");
  });

  it("recognizes nothing else, SVG included", () => {
    expect(sniffImageType(pad("<svg xmlns"))).toBeUndefined();
    expect(sniffImageType(pad("<!doctype html>"))).toBeUndefined();
    expect(sniffImageType(Buffer.from("GIF8"))).toBeUndefined();
  });
});
