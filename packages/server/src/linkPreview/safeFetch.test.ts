import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { FetchRefused, type SafeFetchOptions, safeFetch } from "./safeFetch.js";

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

/** The local test server is on loopback and a random port, which production
 * refuses; everything else about the fetch is the real thing. */
const LOCAL: SafeFetchOptions = {
  maxBytes: 1024,
  overflow: "truncate",
  accept: "*/*",
  isAllowedAddress: (address) => address === "127.0.0.1",
  allowAnyPort: true,
};

describe("safeFetch", () => {
  it("refuses loopback, private and metadata addresses by default", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://localhost/",
    ]) {
      await expect(
        safeFetch(new URL(url), { ...LOCAL, isAllowedAddress: undefined }),
      ).rejects.toThrow(FetchRefused);
    }
  });

  it("refuses a non-default port, credentials, and other schemes", async () => {
    const strict = { ...LOCAL, allowAnyPort: false };
    await expect(
      safeFetch(new URL("http://127.0.0.1:8080/"), strict),
    ).rejects.toThrow("Only default ports");
    await expect(
      safeFetch(new URL("http://user:pw@127.0.0.1/"), strict),
    ).rejects.toThrow("credentials");
    await expect(
      safeFetch(new URL("ftp://127.0.0.1/"), strict),
    ).rejects.toThrow("http(s)");
  });

  it("returns the body and content type of a 200", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<title>Hi</title>");
    });
    const result = await safeFetch(new URL(`${base}/page`), LOCAL);
    expect(result.body.toString()).toBe("<title>Hi</title>");
    expect(result.contentType).toBe("text/html; charset=utf-8");
    expect(result.url.href).toBe(`${base}/page`);
  });

  it("follows a redirect and reports where it ended up", async () => {
    const base = await serve((req, res) => {
      if (req.url === "/old") {
        res.writeHead(301, { Location: "/new" });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end("moved");
    });
    const result = await safeFetch(new URL(`${base}/old`), LOCAL);
    expect(result.body.toString()).toBe("moved");
    expect(result.url.pathname).toBe("/new");
  });

  it("checks the address of every redirect, not just the first", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/" });
      res.end();
    });
    await expect(safeFetch(new URL(base), LOCAL)).rejects.toThrow(
      "Address is not public",
    );
  });

  it("gives up on a redirect loop", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(302, { Location: "/" });
      res.end();
    });
    await expect(safeFetch(new URL(base), LOCAL)).rejects.toThrow(
      "Too many redirects",
    );
  });

  it("refuses a status other than 200", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(404);
      res.end("missing");
    });
    await expect(safeFetch(new URL(base), LOCAL)).rejects.toThrow("Status 404");
  });

  it("truncates or refuses a body over the limit, as asked", async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200);
      res.end("x".repeat(5000));
    });
    const truncated = await safeFetch(new URL(base), LOCAL);
    expect(truncated.body.length).toBe(1024);
    await expect(
      safeFetch(new URL(base), { ...LOCAL, overflow: "refuse" }),
    ).rejects.toThrow("too large");
  });

  it("applies the limit after decompression", async () => {
    // A few KB on the wire that inflates to 10 MB.
    const bomb = zlib.gzipSync(Buffer.alloc(10 * 1024 * 1024));
    const base = await serve((_req, res) => {
      res.writeHead(200, { "Content-Encoding": "gzip" });
      res.end(bomb);
    });
    await expect(
      safeFetch(new URL(base), { ...LOCAL, overflow: "refuse" }),
    ).rejects.toThrow("too large");
  });

  it("decompresses gzip and brotli", async () => {
    const base = await serve((req, res) => {
      const text = Buffer.from("compressed page");
      if (req.url === "/br") {
        res.writeHead(200, { "Content-Encoding": "br" });
        res.end(zlib.brotliCompressSync(text));
        return;
      }
      res.writeHead(200, { "Content-Encoding": "gzip" });
      res.end(zlib.gzipSync(text));
    });
    expect((await safeFetch(new URL(base), LOCAL)).body.toString()).toBe(
      "compressed page",
    );
    expect(
      (await safeFetch(new URL(`${base}/br`), LOCAL)).body.toString(),
    ).toBe("compressed page");
  });

  it("gives up when the server is too slow", async () => {
    const base = await serve(() => {
      // never responds
    });
    await expect(
      safeFetch(new URL(base), { ...LOCAL, timeoutMs: 100 }),
    ).rejects.toThrow("Timed out");
  });
});
