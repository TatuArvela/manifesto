import { describe, expect, it } from "vitest";
import {
  isOAuthConsentPath,
  parseAuthorizeRequest,
  returnTarget,
} from "./oauth.js";

const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function query(overrides: Record<string, string | null> = {}): string {
  const params = new URLSearchParams();
  const fields: Record<string, string | null> = {
    response_type: "code",
    client_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    redirect_uri: "http://localhost:33418/callback",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) params.set(key, value);
  }
  return `?${params}`;
}

describe("the consent page's request", () => {
  it("is read from the address", () => {
    expect(parseAuthorizeRequest(query({ scope: "notes:read" }))).toEqual({
      clientId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      redirectUri: "http://localhost:33418/callback",
      codeChallenge: CHALLENGE,
      state: "xyz",
      scope: "notes:read",
    });
    expect(parseAuthorizeRequest(query({ state: null }))?.state).toBeNull();
  });

  it("is refused without the code flow and an S256 challenge", () => {
    expect(parseAuthorizeRequest(query({ response_type: "token" }))).toBeNull();
    expect(
      parseAuthorizeRequest(query({ code_challenge_method: "plain" })),
    ).toBeNull();
    expect(
      parseAuthorizeRequest(query({ code_challenge_method: null })),
    ).toBeNull();
    expect(
      parseAuthorizeRequest(query({ code_challenge: "short" })),
    ).toBeNull();
    expect(parseAuthorizeRequest(query({ client_id: null }))).toBeNull();
    expect(parseAuthorizeRequest(query({ redirect_uri: null }))).toBeNull();
  });

  it("is on its own path", () => {
    expect(isOAuthConsentPath("/oauth/authorize")).toBe(true);
    expect(isOAuthConsentPath("/oauth/authorize/")).toBe(true);
    expect(isOAuthConsentPath("/oauth")).toBe(false);
    expect(isOAuthConsentPath("/tags/oauth/authorize")).toBe(false);
  });

  it("names where the answer goes as a person would know it", () => {
    expect(returnTarget("http://localhost:33418/callback")).toBe(
      "localhost:33418",
    );
    expect(returnTarget("https://claude.ai/api/mcp/auth_callback")).toBe(
      "claude.ai",
    );
    expect(returnTarget("cursor://anysphere.cursor-retrieval/oauth")).toBe(
      "cursor://",
    );
  });
});
