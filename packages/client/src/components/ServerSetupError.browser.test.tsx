import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerSetupProblem } from "#/utils/serverCsp.ts";
import { ServerSetupError } from "./ServerSetupError.tsx";

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
    // The person who deployed the copy reads the screen. Thus, its value is the
    // two lines that they can paste. Text alone would send them back to the
    // docs to find the wss:// form.
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
    // Nothing to paste into connect-src until the address itself is correct.
    expect(host.querySelector("pre")).toBeNull();
  });

  it("offers no way past itself", () => {
    // The browser blocks each request before it goes out. Thus, there is
    // nothing on the other side of a dismiss button.
    show({
      kind: "csp-blocked",
      serverUrl: "https://notes.acme.com",
      missing: ["wss://notes.acme.com"],
    });
    expect(host.querySelectorAll("button, a")).toHaveLength(0);
  });
});
