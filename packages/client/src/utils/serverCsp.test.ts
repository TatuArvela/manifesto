import { describe, expect, it } from "vitest";
import {
  findServerSetupProblem,
  missingConnectSources,
  requiredConnectOrigins,
} from "./serverCsp.js";

const SHIPPED_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'";

describe("requiredConnectOrigins", () => {
  it("asks for the HTTP origin and the WebSocket one", () => {
    expect(requiredConnectOrigins("https://notes.example.com")).toEqual([
      "https://notes.example.com",
      "wss://notes.example.com",
    ]);
    expect(requiredConnectOrigins("http://localhost:3001")).toEqual([
      "http://localhost:3001",
      "ws://localhost:3001",
    ]);
  });

  it("asks for nothing when the server is this page's own origin", () => {
    // `VITE_MANIFESTO_SERVER=/` trims to the empty string, which is the
    // single-proxy deployment: `'self'` already covers it.
    expect(requiredConnectOrigins("")).toEqual([]);
    expect(requiredConnectOrigins("/api")).toEqual([]);
  });

  it("refuses anything that is not an http(s) address", () => {
    // The likeliest typo: a host with no scheme.
    expect(requiredConnectOrigins("notes.example.com")).toBeNull();
    expect(requiredConnectOrigins("ftp://notes.example.com")).toBeNull();
    expect(requiredConnectOrigins("not a url at all")).toBeNull();
  });
});

describe("missingConnectSources", () => {
  const required = ["https://notes.example.com", "wss://notes.example.com"];
  const page = "https://app.example.com";

  it("reports both origins against the shipped policy", () => {
    expect(missingConnectSources(SHIPPED_CSP, required, page)).toEqual(
      required,
    );
  });

  it("is satisfied by an exact listing of both", () => {
    const policy =
      "connect-src 'self' https://notes.example.com wss://notes.example.com";
    expect(missingConnectSources(policy, required, page)).toEqual([]);
  });

  it("reports only the half that was forgotten", () => {
    // Adding the https origin and missing the wss one is the likelier
    // mistake, and the one whose symptom (sign-in works, sockets die) says
    // least about itself.
    const policy = "connect-src 'self' https://notes.example.com";
    expect(missingConnectSources(policy, required, page)).toEqual([
      "wss://notes.example.com",
    ]);
  });

  it("treats 'self' as covering the page's own origin, sockets included", () => {
    const sameOrigin = ["https://app.example.com", "wss://app.example.com"];
    expect(missingConnectSources(SHIPPED_CSP, sameOrigin, page)).toEqual([]);
  });

  it("accepts a wildcard host, a bare scheme and a blanket star", () => {
    const wildcard =
      "connect-src 'self' https://*.example.com wss://*.example.com";
    expect(missingConnectSources(wildcard, required, page)).toEqual([]);
    expect(
      missingConnectSources("connect-src https: wss:", required, page),
    ).toEqual([]);
    expect(missingConnectSources("connect-src *", required, page)).toEqual([]);
  });

  it("falls back to default-src when there is no connect-src", () => {
    expect(missingConnectSources("default-src 'self'", required, page)).toEqual(
      required,
    );
    expect(
      missingConnectSources(
        "default-src 'self' https://notes.example.com wss://notes.example.com",
        required,
        page,
      ),
    ).toEqual([]);
  });

  it("judges nothing when there is nothing to judge by", () => {
    // A host that sends its policy as a response header leaves no meta tag,
    // and a false alarm would take down a deployment that works.
    expect(missingConnectSources(null, required, page)).toEqual([]);
    expect(missingConnectSources("script-src 'self'", required, page)).toEqual(
      [],
    );
  });
});

describe("findServerSetupProblem", () => {
  const page = "https://app.example.com";

  it("finds nothing in open mode", () => {
    expect(findServerSetupProblem(null, SHIPPED_CSP, page)).toBeNull();
  });

  it("finds nothing when the policy already allows the server", () => {
    const policy =
      "connect-src 'self' https://notes.example.com wss://notes.example.com";
    expect(
      findServerSetupProblem("https://notes.example.com", policy, page),
    ).toBeNull();
  });

  it("names the missing origins for a bundle whose CSP was not edited", () => {
    expect(
      findServerSetupProblem("https://notes.example.com", SHIPPED_CSP, page),
    ).toEqual({
      kind: "csp-blocked",
      serverUrl: "https://notes.example.com",
      missing: ["https://notes.example.com", "wss://notes.example.com"],
    });
  });

  it("calls out a server address that is not an address", () => {
    expect(
      findServerSetupProblem("notes.example.com", SHIPPED_CSP, page),
    ).toEqual({ kind: "invalid-url", serverUrl: "notes.example.com" });
  });

  it("leaves a single-origin deployment alone", () => {
    // The shape server/deployment.md now recommends: one proxy, one origin,
    // stock CSP, nothing to edit. Written either as the site's own absolute
    // URL or relatively, both of which `'self'` covers.
    expect(
      findServerSetupProblem("https://app.example.com", SHIPPED_CSP, page),
    ).toBeNull();
    expect(findServerSetupProblem("", SHIPPED_CSP, page)).toBeNull();
  });
});
