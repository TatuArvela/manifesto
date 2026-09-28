import type { ErrorResponse } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../middleware/authBearer.js";
import { HttpError } from "../middleware/error.js";
import type { StorageDriver } from "../storage/types.js";
import {
  authHeaders,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";
import { RECENT_SIGN_IN_MS, requireConfirmation } from "./confirmation.js";
import {
  createLoginAttempts,
  MAX_LOGIN_FAILURES,
} from "./local/loginAttempts.js";

const PASSWORD = "test-pass-12";

/**
 * A session can be stolen, so what would let its holder keep the account or
 * its notes (an email address, a token, a webhook) asks for the password
 * again, and for an account with none, a recent sign-in.
 */
describe("confirming an action from a session", () => {
  let rig: TestRig;
  let session: string;

  beforeEach(async () => {
    rig = await bootTestAppWith({ webhooks: "public" });
    ({ token: session } = await registerTestUser(rig, "alice", PASSWORD));
  });

  afterEach(async () => {
    await rig.close();
  });

  const send = (method: string, path: string, body: object) =>
    rig.request(path, {
      method,
      headers: authHeaders(session),
      body: JSON.stringify(body),
    });

  async function refusal(res: Response) {
    return { status: res.status, ...((await res.json()) as ErrorResponse) };
  }

  const actions: [string, string, string, object][] = [
    ["minting a token", "POST", "/api/tokens", { name: "script" }],
    [
      "adding a webhook",
      "POST",
      "/api/webhooks",
      { url: "https://hooks.example/notes" },
    ],
    [
      "setting an email address",
      "PUT",
      "/api/auth/me",
      { email: "a@b.example" },
    ],
  ];

  for (const [what, method, path, body] of actions) {
    it(`asks for the password before ${what}`, async () => {
      expect(await refusal(await send(method, path, body))).toMatchObject({
        status: 403,
        code: "confirmation_required",
      });
      expect(
        await refusal(
          await send(method, path, { ...body, password: "not-it-00" }),
        ),
      ).toMatchObject({ status: 403, code: "password_incorrect" });
      const done = await send(method, path, { ...body, password: PASSWORD });
      expect(done.status).toBeLessThan(300);
    });
  }

  it("counts wrong passwords against the same budget as signing in", async () => {
    for (let i = 0; i < MAX_LOGIN_FAILURES; i++) {
      await send("POST", "/api/tokens", { name: "x", password: "not-it-00" });
    }
    const locked = await send("POST", "/api/tokens", {
      name: "x",
      password: PASSWORD,
    });
    expect(locked.status).toBe(429);
    const signIn = await rig.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: PASSWORD }),
    });
    expect(signIn.status).toBe(429);
  });
});

describe("an account without a password", () => {
  // Signed in only through an identity provider, it has nothing to type, so a
  // recent sign-in is the proof; the client gets one with `?reauth`.
  const storage = {
    users: {
      findById: async () => ({ id: "u", username: "sso", passwordHash: null }),
    },
  } as unknown as StorageDriver;
  const deps = { storage, loginAttempts: createLoginAttempts() };
  const signedIn = (msAgo: number): AuthContext => ({
    userId: "u",
    token: "t",
    via: "session",
    signedInAt: new Date(Date.now() - msAgo).toISOString(),
  });

  it("is confirmed by a recent sign-in", async () => {
    await expect(
      requireConfirmation(deps, signedIn(60_000), undefined),
    ).resolves.toBeUndefined();
  });

  it("is asked to sign in again once that sign-in is old", async () => {
    const refused = await requireConfirmation(
      deps,
      signedIn(RECENT_SIGN_IN_MS + 60_000),
      "anything",
    ).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).code).toBe("reauthentication_required");
  });
});
