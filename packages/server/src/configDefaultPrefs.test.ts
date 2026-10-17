import { MAX_ACCOUNT_PREFS_BYTES } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { parseDefaultPrefs } from "./config.ts";

describe("parseDefaultPrefs", () => {
  it("is empty when unset or blank", () => {
    expect(parseDefaultPrefs(undefined)).toEqual({});
    expect(parseDefaultPrefs("  ")).toEqual({});
  });

  it("reads a JSON object, values and all, without judging them", () => {
    expect(
      parseDefaultPrefs('{"theme":"dark","hiddenTags":["work"],"x":1}'),
    ).toEqual({ theme: "dark", hiddenTags: ["work"], x: 1 });
  });

  it("refuses anything but a JSON object", () => {
    expect(() => parseDefaultPrefs("theme=dark")).toThrow(/not valid JSON/);
    expect(() => parseDefaultPrefs('["dark"]')).toThrow(/JSON object/);
    expect(() => parseDefaultPrefs("null")).toThrow(/JSON object/);
    expect(() => parseDefaultPrefs('"dark"')).toThrow(/JSON object/);
  });

  it("refuses more than an account's own preferences may hold", () => {
    const big = JSON.stringify({ x: "a".repeat(MAX_ACCOUNT_PREFS_BYTES) });
    expect(() => parseDefaultPrefs(big)).toThrow(/larger than/);
  });
});
