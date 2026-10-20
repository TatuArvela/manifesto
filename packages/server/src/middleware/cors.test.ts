import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootTestApp, type TestRig } from "#/test/setup.ts";

/**
 * A client on its own origin (the deployment that the docs describe) reaches
 * the API only through what the preflight permits. Thus, the list must contain
 * each header that a request has. If not, the browser refuses the request
 * before the server sees it.
 */
describe("CORS", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
  });

  function preflight(
    method: string,
    headers: string,
    path = "/api/v1/notes/some-id",
  ) {
    return rig.request(path, {
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

  it("allows the address a sealed image upload carries", async () => {
    const res = await preflight(
      "POST",
      "authorization,content-type,x-attachment-address",
      "/api/v1/attachments",
    );
    const allowed = (res.headers.get("Access-Control-Allow-Headers") ?? "")
      .toLowerCase()
      .split(",")
      .map((h) => h.trim());
    expect(allowed).toContain("x-attachment-address");
  });

  it("gives an origin it does not know nothing", async () => {
    const res = await rig.request("/api/v1/notes/some-id", {
      method: "OPTIONS",
      headers: {
        Origin: "https://elsewhere.example",
        "Access-Control-Request-Method": "PUT",
      },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
