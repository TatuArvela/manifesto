import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootTestApp, type TestRig } from "../test/setup.js";

/**
 * A client on its own origin (the deployment the docs describe) reaches the
 * API only through what the preflight allows, so every header a request
 * carries has to be listed, or the browser refuses the request before the
 * server sees it.
 */
describe("CORS", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
  });

  function preflight(method: string, headers: string) {
    return rig.request("/api/notes/some-id", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": headers,
      },
    });
  }

  it("allows the headers an update carries, If-Match included", async () => {
    const res = await preflight("PUT", "authorization,content-type,if-match");
    const allowed = (res.headers.get("Access-Control-Allow-Headers") ?? "")
      .toLowerCase()
      .split(",")
      .map((h) => h.trim());
    expect(allowed).toEqual(
      expect.arrayContaining(["authorization", "content-type", "if-match"]),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173",
    );
  });

  it("gives an origin it does not know nothing", async () => {
    const res = await rig.request("/api/notes/some-id", {
      method: "OPTIONS",
      headers: {
        Origin: "https://elsewhere.example",
        "Access-Control-Request-Method": "PUT",
      },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
