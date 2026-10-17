import { describe, expect, it } from "vitest";
import { groupSecret, otpauthLink } from "./twoFactor.js";

describe("two-factor setup helpers", () => {
  it("groups the key for typing", () => {
    expect(groupSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });

  it("labels the authenticator entry with this deployment's name", () => {
    const link = new URL(otpauthLink("alice", "ABCD"));
    expect(link.protocol).toBe("otpauth:");
    expect(link.searchParams.get("secret")).toBe("ABCD");
    expect(link.searchParams.get("issuer")).toBeTruthy();
    expect(decodeURIComponent(link.pathname)).toMatch(/:alice$/);
  });
});
