import {
  type ApiTokenCreatedResponse,
  SERVER_FEATURES,
  type ServerFeature,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../config.js";
import { OPERATIONS, type Operation } from "../openapi.js";
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
    // Every feature on, so each operation is there to be asked.
    rig = await bootTestAppWith({
      trustProxy: true,
      webhooks: "public",
      adminExport: true,
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

/**
 * A feature the host turned off (`features.ts`) is not there: each operation
 * that names it answers the app's own 404 for a route that does not exist,
 * before anyone is asked to sign in, and answers as usual once it is on. This
 * walks the registry, so a feature's operation left untagged, or a router
 * with its own idea of when it is off, fails here.
 */
describe("features the host turned off", () => {
  /** Every feature on, and the OAuth routes that come with `APP_URL`. */
  const ALL_ON: Partial<ServerConfig> = {
    webhooks: "public",
    adminExport: true,
    appUrl: "http://localhost:5173",
  };

  const offOverride = (feature: ServerFeature): Partial<ServerConfig> =>
    feature === "webhooks" ? { webhooks: "off" } : { [feature]: false };

  function call(rig: TestRig, op: Operation, bearer: string | null) {
    return rig.request(op.path.replace(/:\w+/g, "x"), {
      method: op.method.toUpperCase(),
      headers: {
        "Content-Type": "application/json",
        ...(bearer && { Authorization: `Bearer ${bearer}` }),
      },
      ...(op.method !== "get" && { body: "{}" }),
    });
  }

  /** What this app says for a route it does not have. */
  async function absent(rig: TestRig): Promise<string> {
    const res = await rig.request("/api/no-such-route");
    expect(res.status).toBe(404);
    return res.text();
  }

  const byFeature = (feature: ServerFeature) =>
    OPERATIONS.filter((op) => op.feature === feature && op.provider !== "oidc");

  for (const feature of SERVER_FEATURES) {
    it(`answers ${feature} as an absent route while it is off`, async () => {
      const ops = byFeature(feature);
      const off = await bootTestAppWith({ ...ALL_ON, ...offOverride(feature) });
      const { token } = await registerTestUser(off, "admin");
      const nothing = await absent(off);
      const answered: string[] = [];
      for (const op of ops) {
        for (const bearer of [null, token]) {
          const res = await call(off, op, bearer);
          if (res.status !== 404 || (await res.text()) !== nothing) {
            answered.push(`${op.method} ${op.path}: ${res.status}`);
          }
        }
      }
      await off.close();
      expect(answered).toEqual([]);

      const on = await bootTestAppWith(ALL_ON);
      const admin = await registerTestUser(on, "admin");
      const there = await absent(on);
      const missing: string[] = [];
      for (const op of ops) {
        const res = await call(on, op, admin.token);
        if (res.status === 404 && (await res.text()) === there) {
          missing.push(`${op.method} ${op.path}`);
        }
      }
      await on.close();
      expect(missing).toEqual([]);
    });
  }

  it("names a feature on every operation it has, or says what enforces it", () => {
    // Personal API tokens have no routes of their own: the tokens page holds
    // three kinds, and a token is refused where it is presented.
    const elsewhere = new Set<ServerFeature>(["apiTokens"]);
    for (const feature of SERVER_FEATURES) {
      expect(
        byFeature(feature).length > 0 || elsewhere.has(feature),
        feature,
      ).toBe(true);
    }
  });

  it("closes a feature whose requirement is off", async () => {
    // Teams on by their own switch, but nothing to share with them.
    const rig = await bootTestAppWith({ ...ALL_ON, sharing: false });
    const { token } = await registerTestUser(rig, "admin");
    const nothing = await absent(rig);
    for (const op of byFeature("teams")) {
      const res = await call(rig, op, token);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(nothing);
    }
    await rig.close();
  });

  it("leaves the ways out of a feature open while it is off", async () => {
    const rig = await bootTestAppWith({
      sharing: false,
      passkeys: false,
      twoFactor: false,
    });
    const { token } = await registerTestUser(rig, "alice");
    const nothing = await absent(rig);
    for (const [method, path] of [
      ["DELETE", "/api/notes/x/shares/y"],
      ["DELETE", "/api/notes/x/team-shares/y"],
      ["GET", "/api/notes/x/team-shares"],
      ["GET", "/api/auth/passkeys"],
      ["DELETE", "/api/auth/passkeys/x"],
      ["GET", "/api/auth/two-factor"],
      ["POST", "/api/auth/two-factor/disable"],
    ] as const) {
      const res = await rig.request(path, {
        method,
        headers: authHeaders(token),
        ...(method !== "GET" && { body: "{}" }),
      });
      expect(
        res.status === 404 && (await res.text()) === nothing,
        `${method} ${path}`,
      ).toBe(false);
    }
    await rig.close();
  });

  it("refuses a token whose kind is off, and mints none of it", async () => {
    const rig = await bootTestAppWith({});
    const { token: session } = await registerTestUser(rig, "alice");
    const mint = (kind: string) =>
      rig.request("/api/tokens", {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({ name: kind, kind, password: "test-pass-12" }),
      });
    const minted = await mint("api");
    const { secret } = (await minted.json()) as ApiTokenCreatedResponse;
    const notes = () =>
      rig.request("/api/notes", { headers: authHeaders(secret) });
    expect((await notes()).status).toBe(200);
    // As the next start with `API_TOKENS=off` and `CALENDAR=off` would be.
    rig.cfg.apiTokens = false;
    rig.cfg.calendar = false;
    expect((await notes()).status).toBe(401);
    expect((await mint("api")).status).toBe(403);
    expect((await mint("calendar")).status).toBe(403);
    // Listing and revoking stay open, so a token can always be taken back.
    const list = await rig.request("/api/tokens", {
      headers: authHeaders(session),
    });
    expect(list.status).toBe(200);
    await rig.close();
  });
});
