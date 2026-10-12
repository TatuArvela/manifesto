import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

describe("search route", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
  });

  it("does not search for the app, which holds the only key", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const res = await rig.request("/api/search?q=milk", {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it("wants a signed-in user", async () => {
    expect((await rig.request("/api/search?q=milk")).status).toBe(401);
  });
});
