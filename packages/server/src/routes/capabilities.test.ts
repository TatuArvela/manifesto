import type { CapabilitiesResponse } from "@manifesto/shared";
import { MAX_IMAGE_SOURCE_BYTES } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { bootTestAppWith } from "../test/setup.js";
import { VERSION } from "../version.js";

describe("GET /api/capabilities", () => {
  async function capabilities(overrides = {}) {
    const rig = await bootTestAppWith(overrides);
    const res = await rig.request("/api/capabilities");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CapabilitiesResponse;
    await rig.close();
    return { body };
  }

  it("says what the server offers, without anyone signed in", async () => {
    const { body } = await capabilities();
    expect(body.version).toBe(VERSION);
    expect(body.auth).toEqual({
      providers: ["local"],
      passwordForm: "shown",
      registration: true,
      passwordReset: false,
      passkeys: true,
    });
    expect(body.features).toEqual({
      webhooks: false,
      publicLinks: true,
      linkPreviews: true,
      mcp: true,
      mcpSignIn: false,
      userLookup: "search",
    });
    expect(body.limits.imageBytes).toBe(MAX_IMAGE_SOURCE_BYTES);
    expect(body.limits.requestBytes).toBe(1024 * 1024);
  });

  it("follows the configuration", async () => {
    const { body } = await capabilities({
      webhooks: "public",
      linkPreviews: false,
      registrationEnabled: false,
      appUrl: "https://notes.example",
    });
    expect(body.features).toMatchObject({
      webhooks: true,
      linkPreviews: false,
      mcpSignIn: true,
    });
    expect(body.auth.registration).toBe(false);
  });

  it("refuses a request body over the limit it states", async () => {
    const rig = await bootTestAppWith({});
    const { limits } = (await (
      await rig.request("/api/capabilities")
    ).json()) as CapabilitiesResponse;
    const res = await rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "x".repeat(limits.requestBytes) }),
    });
    expect(res.status).toBe(413);
    await rig.close();
  });
});
