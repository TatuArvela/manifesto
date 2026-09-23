import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootTestAppWith, type TestRig } from "../test/setup.js";

describe("serving the client", () => {
  let rig: TestRig;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "manifesto-client-"));
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "index.html"), "<!doctype html><p>app</p>");
    await writeFile(join(dir, "sw.js"), "self;");
    await writeFile(join(dir, "assets", "index-abc123.js"), "console.log(1)");
    rig = await bootTestAppWith({ clientDir: dir });
  });

  afterEach(async () => {
    await rig.close();
  });

  it("serves the page at the root and for any client route", async () => {
    for (const path of ["/", "/archived", "/tags/work"]) {
      const res = await rig.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<p>app</p>");
      expect(res.headers.get("Cache-Control")).toBe("no-cache");
      expect(res.headers.get("Content-Security-Policy")).toBe(
        "frame-ancestors 'self'",
      );
    }
  });

  it("caches hashed assets for good and the service worker never", async () => {
    const asset = await rig.request("/assets/index-abc123.js");
    expect(asset.headers.get("Cache-Control")).toContain("immutable");
    const sw = await rig.request("/sw.js");
    expect(sw.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("leaves the API to itself", async () => {
    expect((await rig.request("/api/health")).status).toBe(200);
    const unknown = await rig.request("/api/nope");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).not.toContain("<p>app</p>");
    expect((await rig.request("/missing.png")).status).toBe(404);
  });
});
