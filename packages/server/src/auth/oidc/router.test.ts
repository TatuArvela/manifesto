import type * as openid from "openid-client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from "vitest";
import { createApp } from "../../app.js";
import type { OidcConfig, ServerConfig } from "../../config.js";
import { createSqliteStorage } from "../../storage/sqlite/driver.js";
import type { StorageDriver } from "../../storage/types.js";
import { TEST_CONFIG } from "../../test/setup.js";
import type { AuthProvider } from "../types.js";
import { createOidcAuthProvider } from "./provider.js";

vi.mock("openid-client", async () => {
  const actual = await vi.importActual<typeof openid>("openid-client");
  return {
    ...actual,
    discovery: vi.fn(),
    buildAuthorizationUrl: vi.fn(),
    authorizationCodeGrant: vi.fn(),
    fetchUserInfo: vi.fn(),
    randomPKCECodeVerifier: vi.fn(() => "test-code-verifier"),
    calculatePKCECodeChallenge: vi.fn(async () => "test-code-challenge"),
    randomState: vi.fn(() => "test-state-token"),
  };
});

const oidcModule = (await import("openid-client")) as typeof openid & {
  discovery: MockedFunction<typeof openid.discovery>;
  buildAuthorizationUrl: MockedFunction<typeof openid.buildAuthorizationUrl>;
  authorizationCodeGrant: MockedFunction<typeof openid.authorizationCodeGrant>;
  fetchUserInfo: MockedFunction<typeof openid.fetchUserInfo>;
  randomState: MockedFunction<typeof openid.randomState>;
};

const OIDC_CONFIG: OidcConfig = {
  issuer: "https://idp.example.com",
  clientId: "manifesto-client",
  clientSecret: "secret",
  redirectUri: "https://server.example.com/api/auth/callback",
  postLoginRedirect: "https://app.example.com/auth-callback",
  scopes: ["openid", "profile", "email"],
  groupsClaim: "groups",
  adminGroup: null,
  userGroup: null,
  autoRegister: true,
};

const FAKE_DISCOVERY = {} as openid.Configuration;

interface OidcRig {
  cfg: ServerConfig;
  storage: StorageDriver;
  authProvider: AuthProvider;
  /** Requests from one browser: keeps whatever cookies the server sets. */
  request: (input: string, init?: RequestInit) => Promise<Response>;
  /** Requests from a browser that has never seen this server. */
  strangerRequest: (input: string, init?: RequestInit) => Promise<Response>;
  cookies: Map<string, string>;
  close: () => Promise<void>;
}

/**
 * Applies `Set-Cookie` to the jar the way a browser would, including the
 * expiry that `deleteCookie` sends to clear one.
 */
function applySetCookie(jar: Map<string, string>, res: Response): void {
  for (const header of res.headers.getSetCookie()) {
    const [pair = "", ...attrs] = header.split(";");
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const cleared = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
    if (cleared) jar.delete(name);
    else jar.set(name, value);
  }
}

function bootOidcRig(overrides: Partial<OidcConfig> = {}): OidcRig {
  const oidc = { ...OIDC_CONFIG, ...overrides };
  const cfg: ServerConfig = {
    ...TEST_CONFIG,
    authProvider: "oidc",
    oidc,
  };
  const storage = createSqliteStorage(cfg);
  const authProvider = createOidcAuthProvider({
    storage,
    cfg,
    oidc,
    discoveryClient: { getConfig: async () => FAKE_DISCOVERY },
  });
  const { app } = createApp({ cfg, storage, authProvider });
  const cookies = new Map<string, string>();
  return {
    cfg,
    storage,
    authProvider,
    request: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (cookies.size > 0 && !headers.has("cookie")) {
        headers.set(
          "cookie",
          [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        );
      }
      const res = await app.request(input, { ...init, headers });
      applySetCookie(cookies, res);
      return res;
    },
    strangerRequest: async (input, init) => app.request(input, init),
    cookies,
    close: () => storage.close(),
  };
}

function makeIdToken(overrides: Partial<openid.IDToken> = {}): openid.IDToken {
  return {
    iss: OIDC_CONFIG.issuer,
    aud: OIDC_CONFIG.clientId,
    sub: "idp-subject-1",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  } as openid.IDToken;
}

/** The subset of a token response these tests exercise. */
type TokenGrant = Awaited<ReturnType<typeof openid.authorizationCodeGrant>>;

function makeTokenResponse(claims: openid.IDToken): TokenGrant {
  return {
    access_token: "ignored-access-token",
    token_type: "Bearer" as const,
    id_token: "ignored-id-token",
    claims: () => claims,
    expiresIn: () => 3600,
  } as unknown as TokenGrant;
}

describe("oidc auth router", () => {
  let rig: OidcRig;

  beforeEach(() => {
    rig = bootOidcRig();
    oidcModule.discovery.mockResolvedValue(FAKE_DISCOVERY);
    oidcModule.buildAuthorizationUrl.mockReturnValue(
      new URL(
        "https://idp.example.com/authorize?client_id=manifesto-client&state=test-state-token",
      ),
    );
    oidcModule.randomState.mockReturnValue("test-state-token");
  });

  afterEach(async () => {
    await rig.close();
    vi.clearAllMocks();
  });

  it("redirects /login to the IdP authorization endpoint with PKCE + state", async () => {
    const res = await rig.request("/api/auth/login");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(
      /^https:\/\/idp\.example\.com\/authorize\?/,
    );
    const built = oidcModule.buildAuthorizationUrl.mock.calls[0]?.[1] as
      | Record<string, string>
      | undefined;
    expect(built).toMatchObject({
      redirect_uri: OIDC_CONFIG.redirectUri,
      scope: "openid profile email",
      code_challenge: "test-code-challenge",
      code_challenge_method: "S256",
      state: "test-state-token",
    });
  });

  it("on callback, JIT-creates the user and redirects to the post-login URL with a session token in the fragment", async () => {
    await rig.request("/api/auth/login");

    oidcModule.authorizationCodeGrant.mockResolvedValueOnce(
      makeTokenResponse(
        makeIdToken({
          sub: "idp-subject-1",
          // biome-ignore lint/suspicious/noExplicitAny: extra claims
          ...({ preferred_username: "alice", name: "Alice Example" } as any),
        }),
      ),
    );

    const callback = await rig.request(
      "/api/auth/callback?code=auth-code&state=test-state-token",
    );
    expect(callback.status).toBe(302);
    const location = callback.headers.get("location");
    expect(location).toBeTruthy();
    const dest = new URL(location ?? "");
    expect(dest.origin + dest.pathname).toBe(OIDC_CONFIG.postLoginRedirect);
    const fragment = new URLSearchParams(dest.hash.replace(/^#/, ""));
    const token = fragment.get("token");
    expect(token).toBeTruthy();

    const stored = await rig.storage.users.findByExternalId(
      "oidc:https://idp.example.com",
      "idp-subject-1",
    );
    expect(stored?.username).toBe("alice");
    expect(stored?.displayName).toBe("Alice Example");
    expect(stored?.passwordHash).toBeNull();

    // Bearer token works against /api/notes.
    const me = await rig.request("/api/notes", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
  });

  it("re-uses the existing user on subsequent callbacks for the same IdP subject", async () => {
    await rig.request("/api/auth/login");
    oidcModule.authorizationCodeGrant.mockResolvedValueOnce(
      makeTokenResponse(
        makeIdToken({
          sub: "idp-subject-1",
          // biome-ignore lint/suspicious/noExplicitAny: extra claims
          ...({ preferred_username: "alice" } as any),
        }),
      ),
    );
    const first = await rig.request(
      "/api/auth/callback?code=c1&state=test-state-token",
    );
    expect(first.status).toBe(302);
    const firstUser = await rig.storage.users.findByExternalId(
      "oidc:https://idp.example.com",
      "idp-subject-1",
    );
    expect(firstUser).not.toBeNull();

    // Second login round-trip with a fresh state.
    oidcModule.randomState.mockReturnValueOnce("second-state-token");
    await rig.request("/api/auth/login");
    oidcModule.authorizationCodeGrant.mockResolvedValueOnce(
      makeTokenResponse(
        makeIdToken({
          sub: "idp-subject-1",
          // biome-ignore lint/suspicious/noExplicitAny: extra claims
          ...({ preferred_username: "alice" } as any),
        }),
      ),
    );
    const second = await rig.request(
      "/api/auth/callback?code=c2&state=second-state-token",
    );
    expect(second.status).toBe(302);

    const allMatching = await rig.storage.users.findByExternalId(
      "oidc:https://idp.example.com",
      "idp-subject-1",
    );
    expect(allMatching?.id).toBe(firstUser?.id);
  });

  it("rejects callbacks with an unknown state (CSRF / replay)", async () => {
    // Cookie and query agree, so this gets past the browser binding; what
    // the server has forgotten is the flow itself.
    const res = await rig.request(
      "/api/auth/callback?code=foo&state=never-issued",
      { headers: { cookie: "manifesto_oidc_flow=never-issued" } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Unknown or expired login state",
    });
  });

  it("binds the flow to the browser that started it", async () => {
    const login = await rig.request("/api/auth/login");
    const cookie = login.headers.getSetCookie().join("; ");
    expect(cookie).toContain("manifesto_oidc_flow=test-state-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure"); // redirectUri is https in this rig
    expect(cookie).toContain("Path=/api/auth");

    // The attacker holds a valid, unspent state, but the victim's browser
    // has no cookie for it, so the callback must not mint them a session on
    // the attacker's IdP account.
    const victim = await rig.strangerRequest(
      "/api/auth/callback?code=auth-code&state=test-state-token",
    );
    expect(victim.status).toBe(400);
    expect(oidcModule.authorizationCodeGrant).not.toHaveBeenCalled();

    // And the rejection didn't spend the flow: the real browser can still
    // finish its own login.
    oidcModule.authorizationCodeGrant.mockResolvedValueOnce(
      makeTokenResponse(makeIdToken({ sub: "still-valid" })),
    );
    const owner = await rig.request(
      "/api/auth/callback?code=auth-code&state=test-state-token",
    );
    expect(owner.status).toBe(302);
  });

  it("clears the flow cookie once a callback has been spent", async () => {
    await rig.request("/api/auth/login");
    expect(rig.cookies.get("manifesto_oidc_flow")).toBe("test-state-token");

    oidcModule.authorizationCodeGrant.mockResolvedValueOnce(
      makeTokenResponse(makeIdToken({ sub: "spent-flow" })),
    );
    const first = await rig.request(
      "/api/auth/callback?code=c&state=test-state-token",
    );
    expect(first.status).toBe(302);
    expect(rig.cookies.has("manifesto_oidc_flow")).toBe(false);

    // Replaying the same callback URL in the same browser gets nothing.
    const replay = await rig.request(
      "/api/auth/callback?code=c&state=test-state-token",
    );
    expect(replay.status).toBe(400);
  });

  it("throttles the unauthenticated login and callback endpoints per IP", async () => {
    // 30 requests / 15 minutes, shared across both endpoints.
    for (let i = 0; i < 30; i += 1) {
      const res = await rig.request("/api/auth/login");
      expect(res.status).toBe(302);
    }
    const throttled = await rig.request("/api/auth/login");
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBeTruthy();

    const callback = await rig.request(
      "/api/auth/callback?code=c&state=test-state-token",
    );
    expect(callback.status).toBe(429);
  });

  it("rejects callbacks when token exchange fails", async () => {
    await rig.request("/api/auth/login");
    oidcModule.authorizationCodeGrant.mockRejectedValueOnce(
      new Error("invalid_grant"),
    );
    const res = await rig.request(
      "/api/auth/callback?code=bad&state=test-state-token",
    );
    expect(res.status).toBe(401);
  });

  it("falls back to email local-part, then sub, when preferred_username is absent", async () => {
    await rig.request("/api/auth/login");
    oidcModule.authorizationCodeGrant.mockResolvedValueOnce(
      makeTokenResponse(
        makeIdToken({
          sub: "no-preferred",
          // biome-ignore lint/suspicious/noExplicitAny: extra claims
          ...({ email: "carol@example.com" } as any),
        }),
      ),
    );
    await rig.request("/api/auth/callback?code=foo&state=test-state-token");
    const carol = await rig.storage.users.findByExternalId(
      "oidc:https://idp.example.com",
      "no-preferred",
    );
    expect(carol?.username).toBe("carol");
  });

  describe("email addresses", () => {
    let flow = 0;

    /** One sign-in with these claims, each with a state of its own. */
    async function signInWith(claims: Record<string, unknown>) {
      const state = `email-state-${++flow}`;
      oidcModule.randomState.mockReturnValueOnce(state);
      await rig.request("/api/auth/login");
      oidcModule.authorizationCodeGrant.mockResolvedValueOnce(
        makeTokenResponse(makeIdToken(claims as Partial<openid.IDToken>)),
      );
      const res = await rig.request(`/api/auth/callback?code=c&state=${state}`);
      expect(res.status).toBe(302);
      return rig.storage.users.findByExternalId(
        "oidc:https://idp.example.com",
        String(claims.sub),
      );
    }

    it("stores the provider's address and keeps it in step at every sign-in", async () => {
      const first = await signInWith({
        sub: "mail-1",
        email: "dana@example.com",
        email_verified: true,
      });
      expect(first?.email).toBe("dana@example.com");

      const later = await signInWith({
        sub: "mail-1",
        email: "dana@work.example",
      });
      expect(later?.email).toBe("dana@work.example");
    });

    it("does not take an address the provider has not verified", async () => {
      const user = await signInWith({
        sub: "mail-2",
        email: "erin@example.com",
        email_verified: false,
      });
      expect(user?.email).toBeNull();
    });

    it("signs someone in without an address another account holds", async () => {
      await signInWith({ sub: "mail-3", email: "shared@example.com" });
      const second = await signInWith({
        sub: "mail-4",
        email: "SHARED@example.com",
      });
      expect(second).not.toBeNull();
      expect(second?.email).toBeNull();

      const existing = await signInWith({
        sub: "mail-3",
        email: "shared@example.com",
      });
      expect(existing?.email).toBe("shared@example.com");
    });
  });

  it("logout invalidates the session token", async () => {
    await rig.request("/api/auth/login");
    oidcModule.authorizationCodeGrant.mockResolvedValueOnce(
      makeTokenResponse(
        makeIdToken({
          sub: "logout-subject",
          // biome-ignore lint/suspicious/noExplicitAny: extra claims
          ...({ preferred_username: "logoutme" } as any),
        }),
      ),
    );
    const cb = await rig.request(
      "/api/auth/callback?code=c&state=test-state-token",
    );
    const fragment = new URLSearchParams(
      new URL(cb.headers.get("location") ?? "").hash.replace(/^#/, ""),
    );
    const token = fragment.get("token") ?? "";
    expect(token).not.toBe("");

    const out = await rig.request("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(out.status).toBe(204);

    const after = await rig.request("/api/notes", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });
});

describe("oidc groups and registration", () => {
  let rig: OidcRig;

  beforeEach(() => {
    oidcModule.discovery.mockResolvedValue(FAKE_DISCOVERY);
    oidcModule.buildAuthorizationUrl.mockReturnValue(
      new URL("https://idp.example.com/authorize?state=test-state-token"),
    );
    oidcModule.randomState.mockReturnValue("test-state-token");
  });

  afterEach(async () => {
    await rig.close();
    vi.clearAllMocks();
  });

  /** One sign-in round trip; the fragment the client would receive. */
  async function signIn(claims: Record<string, unknown>) {
    await rig.request("/api/auth/login");
    oidcModule.authorizationCodeGrant.mockResolvedValueOnce(
      makeTokenResponse(makeIdToken(claims as Partial<openid.IDToken>)),
    );
    const res = await rig.request(
      "/api/auth/callback?code=c&state=test-state-token",
    );
    expect(res.status).toBe(302);
    const dest = new URL(res.headers.get("location") ?? "");
    return new URLSearchParams(dest.hash.replace(/^#/, ""));
  }

  const account = (sub: string) =>
    rig.storage.users.findByExternalId("oidc:https://idp.example.com", sub);

  it("keeps out anyone outside the user group", async () => {
    rig = bootOidcRig({ userGroup: "notes" });
    const refused = await signIn({ sub: "s1", groups: ["other"] });
    expect(refused.get("error")).toBe("not_in_group");
    expect(await account("s1")).toBeNull();
    const allowed = await signIn({ sub: "s2", groups: ["notes"] });
    expect(allowed.get("token")).toBeTruthy();
  });

  it("makes admin follow the admin group, both ways", async () => {
    rig = bootOidcRig({ adminGroup: "admins" });
    // Someone else is the admin first, so taking it away is allowed.
    await signIn({ sub: "keeper", preferred_username: "keeper" });
    await signIn({
      sub: "s1",
      preferred_username: "alice",
      groups: ["admins"],
    });
    expect((await account("s1"))?.isAdmin).toBe(true);
    await signIn({ sub: "s1", preferred_username: "alice", groups: [] });
    expect((await account("s1"))?.isAdmin).toBe(false);
  });

  it("asks userinfo for groups the ID token leaves out", async () => {
    rig = bootOidcRig({ userGroup: "notes", groupsClaim: "roles" });
    oidcModule.fetchUserInfo.mockResolvedValueOnce({
      sub: "s1",
      roles: "notes",
    } as unknown as Awaited<ReturnType<typeof openid.fetchUserInfo>>);
    const allowed = await signIn({ sub: "s1" });
    expect(allowed.get("token")).toBeTruthy();
  });

  it("with registration off, lets in only accounts that exist", async () => {
    rig = bootOidcRig({ autoRegister: false });
    await rig.storage.users.create({
      id: "u-known",
      username: "known",
      displayName: "",
      avatarColor: "",
      provider: "oidc:https://idp.example.com",
      externalId: "known",
      passwordHash: null,
      createdAt: new Date().toISOString(),
    });
    expect((await signIn({ sub: "known" })).get("token")).toBeTruthy();
    const refused = await signIn({ sub: "stranger" });
    expect(refused.get("error")).toBe("not_registered");
    expect(await account("stranger")).toBeNull();
  });
});
