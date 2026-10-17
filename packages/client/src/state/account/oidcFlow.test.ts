import { describe, expect, it } from "vitest";
import { markOidcFlow, OIDC_FLOW_MS, takeOidcFlow } from "./oidcFlow.ts";

function fakeStorage() {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
    held,
  };
}

describe("the mark of a single sign-on this tab began", () => {
  it("is not there for a tab that only opened a link", () => {
    expect(takeOidcFlow(fakeStorage(), 1000)).toBe(false);
  });

  it("is taken once by the return of the sign-in it was left for", () => {
    const storage = fakeStorage();
    markOidcFlow(storage, 1000);
    expect(takeOidcFlow(storage, 2000)).toBe(true);
    expect(takeOidcFlow(storage, 2000)).toBe(false);
  });

  it("goes stale with the flow, and is spent by the look", () => {
    const storage = fakeStorage();
    markOidcFlow(storage, 1000);
    expect(takeOidcFlow(storage, 1000 + OIDC_FLOW_MS + 1)).toBe(false);
    expect(storage.held.size).toBe(0);
  });

  it("is not something else's text under the same key", () => {
    const storage = fakeStorage();
    storage.setItem("manifesto:oidcFlow", "true");
    expect(takeOidcFlow(storage, 1000)).toBe(false);
  });

  it("refuses rather than throws where storage is blocked or missing", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(() => markOidcFlow(blocked, 1000)).not.toThrow();
    expect(takeOidcFlow(blocked, 1000)).toBe(false);
    expect(takeOidcFlow(null, 1000)).toBe(false);
  });
});
