import type { WebSocketEvent } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

describe("account preferences", () => {
  let rig: TestRig;
  let alice: { token: string; userId: string };

  beforeEach(async () => {
    rig = await bootTestApp();
    alice = await registerTestUser(rig, "alice");
  });

  afterEach(async () => {
    await rig.close();
  });

  const patch = (token: string, prefs: unknown) =>
    rig.request("/api/auth/me/prefs", {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ prefs }),
    });

  it("keeps what a client sends and gives it back to the next", async () => {
    const res = await patch(alice.token, {
      hiddenTags: ["work"],
      theme: "dark",
    });
    expect(res.status).toBe(200);
    const got = await rig.request("/api/auth/me/prefs", {
      headers: authHeaders(alice.token),
    });
    expect(await got.json()).toEqual({
      prefs: { hiddenTags: ["work"], theme: "dark" },
    });
  });

  it("tells the account's sockets, and nobody else's", async () => {
    const bob = await registerTestUser(rig, "bob");
    const heard: [string, WebSocketEvent][] = [];
    rig.broadcaster.subscribe((userId, event) => heard.push([userId, event]));
    await patch(alice.token, { theme: "dark" });
    expect(heard).toEqual([
      [alice.userId, { type: "prefs:updated", prefs: { theme: "dark" } }],
    ]);
    const bobs = await rig.request("/api/auth/me/prefs", {
      headers: authHeaders(bob.token),
    });
    expect(await bobs.json()).toEqual({ prefs: {} });
  });

  it("refuses what is not an object of preferences, or too large", async () => {
    expect((await patch(alice.token, ["dark"])).status).toBe(422);
    expect((await patch(alice.token, { "": 1 })).status).toBe(422);
    const big = await patch(alice.token, { note: "x".repeat(20_000) });
    expect(big.status).toBe(413);
  });

  it("wants a signed-in user", async () => {
    const res = await rig.request("/api/auth/me/prefs");
    expect(res.status).toBe(401);
  });
});
