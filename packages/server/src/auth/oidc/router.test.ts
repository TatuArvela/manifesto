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
    randomPKCECodeVerifier: vi.fn(() => "test-code-verifier"),
    calculatePKCECodeChallenge: vi.fn(async () => "test-code-challenge"),
    randomState: vi.fn(() => "test-state-token"),
  };
});

const oidcModule = (await import("openid-client")) as typeof openid & {
  discovery: MockedFunction<typeof openid.discovery>;
  buildAuthorizationUrl: MockedFunction<typeof openid.buildAuthorizationUrl>;
  authorizationCodeGrant: MockedFunction<typeof openid.authorizationCodeGrant>;
  randomState: MockedFunction<typeof openid.randomState>;
};

const OIDC_CONFIG: OidcConfig = {
  issuer: "https://idp.example.com",
  clientId: "manifesto-client",
  clientSecret: "secret",
  redirectUri: "https://server.example.com/api/auth/callback",
  postLoginRedirect: "https://app.example.com/auth-callback",
  scopes: ["openid", "profile", "email"],
};

const FAKE_DISCOVERY = {} as openid.Configuration;

interface OidcRig {
  cfg: ServerConfig;
  storage: StorageDriver;
  authProvider: AuthProvider;
  request: (input: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

function bootOidcRig(): OidcRig {
  const cfg: ServerConfig = {
    ...TEST_CONFIG,
    authProvider: "oidc",
    oidc: OIDC_CONFIG,
  };
  const storage = createSqliteStorage(cfg);
  const authProvider = createOidcAuthProvider({
    storage,
    cfg,
    oidc: OIDC_CONFIG,
    discoveryClient: { getConfig: async () => FAKE_DISCOVERY },
  });
  const { app } = createApp({ cfg, storage, authProvider });
  return {
    cfg,
    storage,
    authProvider,
    request: async (input, init) => app.request(input, init),
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

function makeTokenResponse(claims: openid.IDToken) {
  return {
    access_token: "ignored-access-token",
    token_type: "Bearer" as const,
    id_token: "ignored-id-token",
    claims: () => claims,
    expiresIn: () => 3600,
  };
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
      // biome-ignore lint/suspicious/noExplicitAny: shape comes from openid-client mock surface
      makeTokenResponse(
        makeIdToken({
          sub: "idp-subject-1",
          // biome-ignore lint/suspicious/noExplicitAny: extra claims
          ...({ preferred_username: "alice", name: "Alice Example" } as any),
        }),
      ) as any,
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
      ) as any,
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
      ) as any,
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
    const res = await rig.request(
      "/api/auth/callback?code=foo&state=never-issued",
    );
    expect(res.status).toBe(400);
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
      ) as any,
    );
    await rig.request("/api/auth/callback?code=foo&state=test-state-token");
    const carol = await rig.storage.users.findByExternalId(
      "oidc:https://idp.example.com",
      "no-preferred",
    );
    expect(carol?.username).toBe("carol");
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
      ) as any,
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
