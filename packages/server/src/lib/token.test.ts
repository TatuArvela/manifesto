import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  API_TOKEN_PREFIX,
  CALENDAR_TOKEN_PREFIX,
  hashToken,
  MCP_TOKEN_PREFIX,
  newApiToken,
  newSessionToken,
  REFRESH_TOKEN_PREFIX,
  SHOWN_PREFIX_LENGTH,
  safeEqual,
} from "./token.js";

describe("tokens", () => {
  it("mints session tokens of 256 random bits, never the same twice", () => {
    const tokens = new Set(Array.from({ length: 200 }, newSessionToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mints API tokens under the prefix asked for, safe in a header and a URL", () => {
    for (const prefix of [
      API_TOKEN_PREFIX,
      MCP_TOKEN_PREFIX,
      REFRESH_TOKEN_PREFIX,
      CALENDAR_TOKEN_PREFIX,
    ]) {
      const token = newApiToken(prefix);
      expect(token.startsWith(prefix)).toBe(true);
      expect(token.slice(prefix.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(newApiToken().startsWith(API_TOKEN_PREFIX)).toBe(true);
  });

  it("keeps the prefixes apart, so no kind of token passes for another", () => {
    const prefixes = [
      API_TOKEN_PREFIX,
      MCP_TOKEN_PREFIX,
      REFRESH_TOKEN_PREFIX,
      CALENDAR_TOKEN_PREFIX,
    ];
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const a of prefixes) {
      for (const b of prefixes) {
        if (a !== b) expect(a.startsWith(b), `${a} ${b}`).toBe(false);
      }
    }
    // The part shown in Settings tells tokens apart without giving one away.
    expect(SHOWN_PREFIX_LENGTH).toBeLessThan(API_TOKEN_PREFIX.length + 43);
  });

  it("stores a token as its SHA-256, which the token alone reproduces", () => {
    const token = newApiToken();
    expect(hashToken(token)).toBe(
      createHash("sha256").update(token, "utf8").digest("hex"),
    );
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(`${token}x`)).not.toBe(hashToken(token));
  });

  it("compares secrets of any length without throwing", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreT")).toBe(false);
    expect(safeEqual("secret", "secret-but-longer")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "x")).toBe(false);
    expect(safeEqual("äö", "äö")).toBe(true);
  });
});
