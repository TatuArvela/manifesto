import { describe, expect, it } from "vitest";
import { isNewer, releaseCore, startUpdateCheck } from "./updateCheck.js";

describe("isNewer", () => {
  it("compares releases by number, not by text", () => {
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("0.2.0", "0.1.99")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("0.1.8", "0.1.9")).toBe(false);
  });

  it("treats a build past a release as that release", () => {
    expect(isNewer("0.1.8", "0.1.8+14.bf5a6dd")).toBe(false);
    expect(isNewer("0.1.9", "0.1.8+14.bf5a6dd")).toBe(true);
  });

  it("says nothing for a version it cannot read", () => {
    expect(isNewer("nightly", "0.1.8")).toBe(false);
    expect(releaseCore("v2.3.4")).toEqual([2, 3, 4]);
  });
});

describe("startUpdateCheck", () => {
  it("records the newest release and whether it is news", async () => {
    const checker = startUpdateCheck("owner/repo", "0.1.8", async () => ({
      tag: "v0.2.0",
      url: "https://github.com/owner/repo/releases/tag/v0.2.0",
    }));
    await new Promise((r) => setTimeout(r, 10));
    expect(checker.status()).toMatchObject({
      latest: "0.2.0",
      available: true,
    });
    checker.stop();
  });
});
