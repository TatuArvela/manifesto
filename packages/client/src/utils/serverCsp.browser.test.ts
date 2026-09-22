import { afterEach, describe, expect, it } from "vitest";
import { serverSetupProblem } from "./serverCsp.js";

/**
 * The half that reads the document it was served as. The policy is injected
 * rather than declared, so the browser never enforces it; what is under test
 * is that the tag is found and read, which is all this function does with it.
 */
function withPolicy<T>(content: string, fn: () => T): T {
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = content;
  document.head.appendChild(meta);
  try {
    return fn();
  } finally {
    meta.remove();
  }
}

afterEach(() => {
  for (const meta of document.querySelectorAll(
    'meta[http-equiv="Content-Security-Policy" i]',
  )) {
    meta.remove();
  }
});

describe("serverSetupProblem", () => {
  it("finds nothing in open mode", () => {
    expect(
      withPolicy("connect-src 'self'", () => serverSetupProblem(null)),
    ).toBeNull();
  });

  it("judges nothing when the document carries no policy of its own", () => {
    // A host serving its CSP as a response header. Blocking a deployment
    // that works would be far worse than missing one that does not.
    expect(serverSetupProblem("https://notes.acme.com")).toBeNull();
  });

  it("catches the edit that named a server and left the policy alone", () => {
    expect(
      withPolicy("default-src 'self'; connect-src 'self'", () =>
        serverSetupProblem("https://notes.acme.com"),
      ),
    ).toEqual({
      kind: "csp-blocked",
      serverUrl: "https://notes.acme.com",
      missing: ["https://notes.acme.com", "wss://notes.acme.com"],
    });
  });

  it("passes once both origins are in connect-src", () => {
    expect(
      withPolicy(
        "connect-src 'self' https://notes.acme.com wss://notes.acme.com",
        () => serverSetupProblem("https://notes.acme.com"),
      ),
    ).toBeNull();
  });

  it("passes a server on this page's own origin against the stock policy", () => {
    // The single-proxy deployment, where `'self'` covers both the REST calls
    // and the sockets and there is nothing for an operator to edit.
    expect(
      withPolicy("connect-src 'self'", () =>
        serverSetupProblem(window.location.origin),
      ),
    ).toBeNull();
    expect(
      withPolicy("connect-src 'self'", () => serverSetupProblem("")),
    ).toBeNull();
  });
});
