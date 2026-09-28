import type { ApiTokenCreatedResponse } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OPERATIONS } from "../openapi.js";
import {
  authHeaders,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

/**
 * Every operation is protected as `OPERATIONS` declares it, and nothing else
 * decides: this walks the list, so a declaration that is wrong, or a route
 * that grew its own idea of who may call it, fails here.
 */
describe("route protection", () => {
  let rig: TestRig;
  let admin: string;
  let member: string;
  let token: string;
  let address = 0;

  beforeEach(async () => {
    // Every request below from an address of its own, so the sign-in
    // bucket's ten per address never answers first.
    rig = await bootTestAppWith({
      trustProxy: true,
      webhooks: "public",
      appUrl: "http://localhost:5173",
    });
    ({ token: admin } = await registerTestUser(rig, "admin"));
    ({ token: member } = await registerTestUser(rig, "member"));
    const minted = await rig.request("/api/tokens", {
      method: "POST",
      headers: authHeaders(member),
      body: JSON.stringify({
        name: "script",
        password: "test-pass-12",
        scopes: [
          "notes:read",
          "notes:write",
          "sharing",
          "account:read",
          "account:write",
        ],
      }),
    });
    token = ((await minted.json()) as ApiTokenCreatedResponse).secret;
  });

  afterEach(async () => {
    await rig.close();
  });

  const operations = OPERATIONS.filter((op) => op.provider !== "oidc");

  function call(
    op: (typeof OPERATIONS)[number],
    bearer: string | null,
  ): Promise<Response> {
    address += 1;
    return rig.request(op.path.replace(/:\w+/g, "x"), {
      method: op.method.toUpperCase(),
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `10.${(address >> 8) & 255}.${address & 255}.1`,
        ...(bearer && { Authorization: `Bearer ${bearer}` }),
      },
      ...(op.method !== "get" && { body: "{}" }),
    });
  }

  it("asks every operation that is not public for a credential", async () => {
    const open: string[] = [];
    for (const op of operations.filter((o) => o.auth !== "none")) {
      const res = await call(op, null);
      if (res.status !== 401)
        open.push(`${op.method} ${op.path}: ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it("refuses an API token where a session is declared", async () => {
    const open: string[] = [];
    for (const op of operations.filter(
      (o) => o.auth === "session" || o.auth === "admin" || o.auth === "mcp",
    )) {
      const res = await call(op, token);
      if (res.status !== 403)
        open.push(`${op.method} ${op.path}: ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it("refuses anyone but an admin where an admin is declared", async () => {
    const admins = operations.filter((o) => o.auth === "admin");
    expect(admins.length).toBeGreaterThan(0);
    const refusal = async (res: Response) =>
      res.status === 403
        ? ((await res.json()) as { error: string }).error
        : null;
    for (const op of admins) {
      expect(await refusal(await call(op, member))).toBe(
        "Admin access required",
      );
      // Past the check: anything else, a 403 of the route's own included
      // (the export while `ADMIN_EXPORT` is off).
      expect(await refusal(await call(op, admin))).not.toBe(
        "Admin access required",
      );
    }
  });

  it("keeps what secures an account to a session", () => {
    // A token handed to a script must not be able to take over its account:
    // tokens, webhooks, the password, email, two-factor, passkeys, sign-in
    // by OAuth, and the admin API.
    const guarded = [
      /^\/api\/tokens/,
      /^\/api\/webhooks/,
      /^\/api\/admin\//,
      /^\/api\/auth\/(password|two-factor|passkeys)/,
      /^\/api\/oauth\/(client|authorize)$/,
    ];
    const loose = OPERATIONS.filter(
      (op) =>
        guarded.some((pattern) => pattern.test(op.path)) &&
        op.auth !== "session" &&
        op.auth !== "admin" &&
        !(
          op.path === "/api/auth/password-reset" ||
          op.path === "/api/auth/password-reset/confirm"
        ),
    ).map((op) => `${op.method} ${op.path}`);
    expect(loose).toEqual([]);
    const email = OPERATIONS.find(
      (op) => op.method === "put" && op.path === "/api/auth/me",
    );
    expect(email?.auth).toBe("session");
  });

  it("closes a route nobody declared", async () => {
    // Its own app, since a route cannot be added once one has answered.
    const fresh = await bootTestAppWith({});
    fresh.app.get("/api/undeclared", (c) => c.text("open"));
    const res = await fresh.request("/api/undeclared");
    expect(res.status).toBe(403);
    expect(await res.text()).not.toBe("open");
    await fresh.close();
  });

  it("counts a bucket across the operations that share it", async () => {
    // Two routes on `user`: moving between them gains nothing.
    let last = 0;
    for (let i = 0; i < 301; i++) {
      const res = await rig.request(i % 2 ? "/api/notes" : "/api/search?q=a", {
        headers: authHeaders(member),
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
