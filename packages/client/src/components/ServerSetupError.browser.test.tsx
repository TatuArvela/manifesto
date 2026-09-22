import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerSetupProblem } from "../utils/serverCsp.js";
import { ServerSetupError } from "./ServerSetupError.js";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

function show(problem: ServerSetupProblem): string {
  render(<ServerSetupError problem={problem} />, host);
  return host.textContent ?? "";
}

describe("ServerSetupError", () => {
  it("prints the exact origins to add to connect-src", () => {
    // The screen is read by whoever deployed the copy, so what it is worth
    // is the two lines they can paste; prose alone would send them back to
    // the docs to work out the wss:// form.
    const text = show({
      kind: "csp-blocked",
      serverUrl: "https://notes.acme.com",
      missing: ["https://notes.acme.com", "wss://notes.acme.com"],
    });
    const pre = host.querySelector("pre")?.textContent ?? "";
    expect(pre).toContain("https://notes.acme.com");
    expect(pre).toContain("wss://notes.acme.com");
    expect(text).toContain("connect-src");
    expect(text).toContain("index.html");
  });

  it("names the server it was pointed at", () => {
    expect(
      show({
        kind: "csp-blocked",
        serverUrl: "https://notes.acme.com",
        missing: ["wss://notes.acme.com"],
      }),
    ).toContain("https://notes.acme.com");
  });

  it("says what is wrong with an address that is not one, and offers no fix list", () => {
    const text = show({
      kind: "invalid-url",
      serverUrl: "notes.acme.com",
    });
    expect(text).toContain("notes.acme.com");
    expect(text).toContain("https://notes.example.com");
    // Nothing to paste into connect-src until the address itself is fixed.
    expect(host.querySelector("pre")).toBeNull();
  });

  it("offers no way past itself", () => {
    // Every request is blocked before it is sent, so there is nothing on the
    // other side of a dismiss button.
    show({
      kind: "csp-blocked",
      serverUrl: "https://notes.acme.com",
      missing: ["wss://notes.acme.com"],
    });
    expect(host.querySelectorAll("button, a")).toHaveLength(0);
  });
});
