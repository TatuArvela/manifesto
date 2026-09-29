import { createHash, randomBytes } from "node:crypto";
import type {
  ApiTokensResponse,
  CapabilitiesResponse,
  OAuthAuthorizeResponse,
  OAuthClientInfo,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createAuthProvider } from "../auth/index.js";
import { hashToken } from "../lib/token.js";
import { createStorage } from "../storage/index.js";
import { defined } from "../test/defined.js";
import {
  authHeaders,
  bootTestAppWith,
  registerTestUser,
  TEST_CONFIG,
  type TestRig,
} from "../test/setup.js";

const REDIRECT = "http://localhost:33418/callback";
const PASSWORD = "test-pass-12";

interface TokenAnswer {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

describe("OAuth for /api/mcp", () => {
  let rig: TestRig;
  let session: string;

  beforeEach(async () => {
    rig = await bootTestAppWith({ appUrl: "https://notes.example" });
    ({ token: session } = await registerTestUser(rig, "alice", PASSWORD));
  });

  afterEach(async () => {
    await rig.close();
  });

  async function register(body: object = {}) {
    return rig.request("/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude Code",
        redirect_uris: [REDIRECT],
        ...body,
      }),
    });
  }

  async function registeredClient(): Promise<string> {
    const res = await register();
    expect(res.status).toBe(201);
    return ((await res.json()) as { client_id: string }).client_id;
  }

  async function authorize(
    clientId: string,
    challenge: string,
    overrides: object = {},
  ) {
    return rig.request("/api/oauth/authorize", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        clientId,
        redirectUri: REDIRECT,
        codeChallenge: challenge,
        state: "xyz",
        scopes: ["notes:read", "notes:write"],
        password: PASSWORD,
        ...overrides,
      }),
    });
  }

  async function codeFor(clientId: string, challenge: string) {
    const res = await authorize(clientId, challenge);
    expect(res.status).toBe(200);
    const { redirectTo } = (await res.json()) as OAuthAuthorizeResponse;
    const url = new URL(redirectTo);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("xyz");
    return url.searchParams.get("code") as string;
  }

  function token(fields: Record<string, string>) {
    return rig.request("/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  }

  async function signIn(clientId: string): Promise<TokenAnswer> {
    const { verifier, challenge } = pkce();
    const code = await codeFor(clientId, challenge);
    const res = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT,
      resource: "https://notes.example/api/mcp",
    });
    expect(res.status).toBe(200);
    return (await res.json()) as TokenAnswer;
  }

  function mcp(bearer: string) {
    return rig.request("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  }

  it("says where to sign in, from a 401 at /api/mcp onwards", async () => {
    const refused = await rig.request("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(refused.status).toBe(401);
    expect(refused.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/mcp"',
    );

    const resource = await rig.request(
      "/.well-known/oauth-protected-resource/api/mcp",
    );
    expect(resource.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await resource.json()).toMatchObject({
      resource: "http://localhost/api/mcp",
      authorization_servers: ["http://localhost"],
    });

    const server = await (
      await rig.request("/.well-known/oauth-authorization-server")
    ).json();
    expect(server).toMatchObject({
      issuer: "http://localhost",
      authorization_endpoint: "https://notes.example/oauth/authorize",
      token_endpoint: "http://localhost/api/oauth/token",
      registration_endpoint: "http://localhost/api/oauth/register",
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
    });
  });

  it("names the proxy's scheme and host when the proxy is trusted", async () => {
    const trusted = await bootTestAppWith({
      appUrl: "https://notes.example",
      trustProxy: true,
    });
    const res = await trusted.request(
      "/.well-known/oauth-authorization-server",
      {
        headers: {
          "X-Forwarded-Proto": "https",
          "X-Forwarded-Host": "notes.example",
        },
      },
    );
    expect((await res.json()).issuer).toBe("https://notes.example");
    await trusted.close();
  });

  it("tells the client it can sign in", async () => {
    const methods = (await (
      await rig.request("/api/capabilities")
    ).json()) as CapabilitiesResponse;
    expect(methods.features.mcpSignIn).toBe(true);
  });

  it("signs an assistant in, lets it reach /api/mcp, and refreshes it", async () => {
    const clientId = await registeredClient();
    const first = await signIn(clientId);
    expect(first).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "notes:read notes:write",
    });
    expect(first.access_token.startsWith("mfm_")).toBe(true);
    expect(first.refresh_token.startsWith("mfr_")).toBe(true);
    expect((await mcp(first.access_token)).status).toBe(200);
    // The refresh token opens nothing.
    expect((await mcp(first.refresh_token)).status).toBe(401);
    // Nor does the access token anywhere but /api/mcp.
    const rest = await rig.request("/api/notes", {
      headers: authHeaders(first.access_token),
    });
    expect(rest.status).toBe(403);

    const listed = (await (
      await rig.request("/api/tokens", { headers: authHeaders(session) })
    ).json()) as ApiTokensResponse;
    expect(listed.tokens).toMatchObject([
      { name: "Claude Code", kind: "mcp", oauthClientId: clientId },
    ]);

    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: clientId,
    });
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as TokenAnswer;
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await mcp(first.access_token)).status).toBe(401);
    expect((await mcp(second.access_token)).status).toBe(200);
  });

  it("refuses an access token past its hour", async () => {
    const clientId = await registeredClient();
    const { refresh_token } = await signIn(clientId);
    // Not by moving the clock: `nowIso` never goes back, and would carry an
    // hour's jump into every later test.
    await rig.storage.apiTokens.rotate(hashToken(refresh_token), {
      tokenHash: hashToken("mfm_lapsed"),
      refreshHash: hashToken("mfr_next"),
      accessExpiresAt: "2020-01-01T00:00:00.000Z",
    });
    expect((await mcp("mfm_lapsed")).status).toBe(401);
  });

  it("ends the grant when a refresh token comes back after it was replaced", async () => {
    const clientId = await registeredClient();
    const first = await signIn(clientId);
    const refresh = (value: string) =>
      token({
        grant_type: "refresh_token",
        refresh_token: value,
        client_id: clientId,
      });
    const second = (await (
      await refresh(first.refresh_token)
    ).json()) as TokenAnswer;
    const replay = await refresh(first.refresh_token);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");
    // The copy's holder and the assistant alike are out.
    expect((await refresh(second.refresh_token)).status).toBe(400);
    expect((await mcp(second.access_token)).status).toBe(401);
  });

  it("stops a grant revoked in Settings", async () => {
    const clientId = await registeredClient();
    const first = await signIn(clientId);
    const listed = (await (
      await rig.request("/api/tokens", { headers: authHeaders(session) })
    ).json()) as ApiTokensResponse;
    await rig.request(`/api/tokens/${defined(listed.tokens[0]).id}`, {
      method: "DELETE",
      headers: authHeaders(session),
    });
    expect((await mcp(first.access_token)).status).toBe(401);
    const res = await token({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: clientId,
    });
    expect(res.status).toBe(400);
  });

  it("takes a code once, from the client it was given to, with its verifier", async () => {
    const clientId = await registeredClient();
    const other = await registeredClient();
    const { verifier, challenge } = pkce();

    const wrongVerifier = await codeFor(clientId, challenge);
    expect(
      (
        await token({
          grant_type: "authorization_code",
          code: wrongVerifier,
          code_verifier: pkce().verifier,
          client_id: clientId,
        })
      ).status,
    ).toBe(400);

    const wrongClient = await codeFor(clientId, challenge);
    expect(
      (
        await token({
          grant_type: "authorization_code",
          code: wrongClient,
          code_verifier: verifier,
          client_id: other,
        })
      ).status,
    ).toBe(400);

    const code = await codeFor(clientId, challenge);
    const redeem = () =>
      token({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: clientId,
      });
    expect((await redeem()).status).toBe(200);
    expect((await redeem()).status).toBe(400);
  });

  it("refuses a code for a resource other than /api/mcp", async () => {
    const clientId = await registeredClient();
    const { verifier, challenge } = pkce();
    const code = await codeFor(clientId, challenge);
    const res = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      resource: "https://notes.example/api/notes",
    });
    expect((await res.json()).error).toBe("invalid_target");
  });

  it("gives a read-only grant only the tools that read", async () => {
    const clientId = await registeredClient();
    const { verifier, challenge } = pkce();
    const res = await authorize(clientId, challenge, {
      scopes: ["notes:read"],
    });
    const code = new URL(
      ((await res.json()) as OAuthAuthorizeResponse).redirectTo,
    ).searchParams.get("code") as string;
    const answer = (await (
      await token({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        client_id: clientId,
      })
    ).json()) as TokenAnswer;
    expect(answer.scope).toBe("notes:read");
    const tools = (await (await mcp(answer.access_token)).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(tools.result.tools.map((t) => t.name)).not.toContain("create_note");
  });

  it("asks for the password, as minting a token does", async () => {
    const clientId = await registeredClient();
    const res = await authorize(clientId, pkce().challenge, {
      password: undefined,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("confirmation_required");
  });

  it("describes the client to the consent page, and refuses an address it did not register", async () => {
    const clientId = await registeredClient();
    const query = (redirect: string, scope = "notes:read") =>
      rig.request(
        `/api/oauth/client?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&scope=${encodeURIComponent(scope)}`,
        { headers: authHeaders(session) },
      );
    const info = (await (await query(REDIRECT)).json()) as OAuthClientInfo;
    expect(info).toEqual({
      clientId,
      name: "Claude Code",
      publisher: null,
      redirectUri: REDIRECT,
      scopes: ["notes:read"],
    });
    // Another loopback port is the same desktop app.
    expect((await query("http://localhost:5000/callback")).status).toBe(200);
    expect((await query("https://evil.example/callback")).status).toBe(400);
    expect((await query(REDIRECT, "account:write")).status).toBe(400);
    expect(
      (
        await authorize(clientId, pkce().challenge, {
          redirectUri: "https://evil.example/callback",
        })
      ).status,
    ).toBe(400);
  });

  it("refuses to register an address a browser would run or read", async () => {
    for (const uri of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "http://notes.example/callback",
      "https://example.com/cb#fragment",
      "not a url",
    ]) {
      const res = await register({ redirect_uris: [uri] });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_redirect_uri");
    }
    expect(
      (await register({ redirect_uris: ["cursor://anysphere/oauth"] })).status,
    ).toBe(201);
    expect(
      (await register({ grant_types: ["client_credentials"] })).status,
    ).toBe(400);
    const publicClient = await register({
      token_endpoint_auth_method: "client_secret_basic",
    });
    expect((await publicClient.json()).token_endpoint_auth_method).toBe("none");
  });

  it("is not offered when the server does not know where its client is", async () => {
    const bare = await bootTestAppWith({ appUrl: null });
    expect(
      (await bare.request("/.well-known/oauth-authorization-server")).status,
    ).toBe(404);
    const refused = await bare.request("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(refused.headers.get("WWW-Authenticate")).toBeNull();
    await bare.close();
  });
});

describe("OAuth clients identified by a metadata document", () => {
  const CLIENT_ID = "https://assistant.example/oauth/client.json";

  async function boot(document: unknown) {
    const cfg = { ...TEST_CONFIG, appUrl: "https://notes.example" };
    const storage = await createStorage(cfg);
    const fetched: string[] = [];
    const { app } = createApp({
      cfg,
      storage,
      authProvider: createAuthProvider(cfg, storage),
      fetchClientMetadata: async (url) => {
        fetched.push(url.href);
        return document;
      },
    });
    const rig = {
      request: (input: string, init?: RequestInit) => app.request(input, init),
    } as TestRig;
    const { token } = await registerTestUser(rig, "alice", PASSWORD);
    return { app, storage, token, fetched };
  }

  it("reads the client's name and addresses from its document", async () => {
    const { app, storage, token, fetched } = await boot({
      client_id: CLIENT_ID,
      client_name: "Assistant",
      redirect_uris: [REDIRECT],
    });
    const lookup = () =>
      app.request(
        `/api/oauth/client?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT)}`,
        { headers: authHeaders(token) },
      );
    const info = (await (await lookup()).json()) as OAuthClientInfo;
    expect(info).toMatchObject({
      name: "Assistant",
      publisher: "assistant.example",
      scopes: ["notes:read", "notes:write"],
    });
    await lookup();
    // Kept a while rather than fetched for every call.
    expect(fetched).toEqual([CLIENT_ID]);
    await storage.close();
  });

  it("refuses a document that names another client", async () => {
    const { app, storage, token } = await boot({
      client_id: "https://elsewhere.example/client.json",
      redirect_uris: [REDIRECT],
    });
    const res = await app.request(
      `/api/oauth/client?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT)}`,
      { headers: authHeaders(token) },
    );
    expect(res.status).toBe(400);
    await storage.close();
  });
});
