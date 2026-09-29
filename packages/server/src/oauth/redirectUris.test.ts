import { describe, expect, it } from "vitest";
import {
  MAX_REDIRECT_URI_LENGTH,
  redirectUriMatches,
  redirectUriProblem,
} from "./redirectUris.js";

describe("redirectUriProblem", () => {
  it("accepts https anywhere, http to this computer, and an app's own scheme", () => {
    for (const uri of [
      "https://assistant.example/callback",
      "https://assistant.example:8443/cb?state=kept",
      "http://localhost/callback",
      "http://localhost:33418/callback",
      "http://127.0.0.1:5000/cb",
      "http://127.8.9.10/cb",
      "http://[::1]:5000/cb",
      "cursor://anysphere.cursor-retrieval/oauth/callback",
      "com.example.app:/oauth2redirect",
    ]) {
      expect(redirectUriProblem(uri), uri).toBeNull();
    }
  });

  it("refuses every scheme a browser would run, read or treat as its own", () => {
    for (const uri of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "file:///etc/passwd",
      "blob:https://assistant.example/uuid",
      "about:blank",
      "filesystem:https://assistant.example/temporary/x",
      "ws://localhost/cb",
      "wss://assistant.example/cb",
      "ftp://assistant.example/cb",
    ]) {
      expect(redirectUriProblem(uri), uri).toBe("uses a refused scheme");
    }
  });

  it("refuses plain http to anywhere but a loopback address", () => {
    for (const uri of [
      "http://notes.example/cb",
      "http://localhost.evil.example/cb",
      "http://127.0.0.1.evil.example/cb",
      "http://10.0.0.1/cb",
      "http://[::2]/cb",
      "http://0.0.0.0/cb",
    ]) {
      expect(redirectUriProblem(uri), uri).toBe(
        "uses http to somewhere other than this computer",
      );
    }
  });

  it("refuses a fragment, credentials, a relative address and an overlong one", () => {
    expect(redirectUriProblem("https://a.example/cb#x")).toBe("has a fragment");
    expect(redirectUriProblem("https://user:pw@a.example/cb")).toBe(
      "carries credentials",
    );
    expect(redirectUriProblem("https://user@a.example/cb")).toBe(
      "carries credentials",
    );
    expect(redirectUriProblem("/callback")).toBe("is not an absolute address");
    expect(redirectUriProblem("")).toBe("is not an absolute address");
    const long = `https://a.example/${"x".repeat(MAX_REDIRECT_URI_LENGTH)}`;
    expect(redirectUriProblem(long)).toBe("is too long");
  });
});

describe("redirectUriMatches", () => {
  const registered = [
    "https://assistant.example/callback",
    "http://127.0.0.1:3000/callback",
    "cursor://anysphere/oauth",
  ];

  it("matches a registered address exactly", () => {
    for (const uri of registered) {
      expect(redirectUriMatches(registered, uri), uri).toBe(true);
    }
  });

  it("lets a loopback address come back on another port, and nothing else change", () => {
    expect(
      redirectUriMatches(registered, "http://127.0.0.1:49152/callback"),
    ).toBe(true);
    expect(redirectUriMatches(registered, "http://127.0.0.1/callback")).toBe(
      true,
    );
    // Another path, host, query or scheme is another address.
    expect(redirectUriMatches(registered, "http://127.0.0.1:5/other")).toBe(
      false,
    );
    expect(
      redirectUriMatches(registered, "http://localhost:3000/callback"),
    ).toBe(false);
    expect(
      redirectUriMatches(registered, "http://127.0.0.1:3000/callback?x=1"),
    ).toBe(false);
    expect(
      redirectUriMatches(registered, "https://127.0.0.1:3000/callback"),
    ).toBe(false);
  });

  it("never loosens the port of an https address", () => {
    expect(
      redirectUriMatches(registered, "https://assistant.example:8443/callback"),
    ).toBe(false);
  });

  it("refuses a loopback address when only an https one is registered", () => {
    expect(
      redirectUriMatches(
        ["https://assistant.example/callback"],
        "http://127.0.0.1:3000/callback",
      ),
    ).toBe(false);
  });

  it("refuses credentials smuggled onto a loopback address", () => {
    expect(
      redirectUriMatches(registered, "http://evil@127.0.0.1:3000/callback"),
    ).toBe(false);
  });

  it("refuses what is not an address, and survives a registration that is not one", () => {
    expect(redirectUriMatches(registered, "not a url")).toBe(false);
    expect(
      redirectUriMatches(["not a url"], "http://127.0.0.1:1/callback"),
    ).toBe(false);
  });
});
