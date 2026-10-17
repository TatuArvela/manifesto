import { describe, expect, it } from "vitest";
import { newUserKey, parseUserKey, userKeyKindOf } from "./userKey.ts";

describe("newUserKey", () => {
  it("is seven groups of four behind the prefix of its kind", () => {
    expect(newUserKey("secret")).toMatch(/^SK(-[2-9A-HJKMNP-Z]{4}){7}$/);
    expect(newUserKey("recovery")).toMatch(/^RK(-[2-9A-HJKMNP-Z]{4}){7}$/);
  });

  it("is new each time", () => {
    const keys = new Set(
      Array.from({ length: 50 }, () => newUserKey("secret")),
    );
    expect(keys.size).toBe(50);
  });

  it("uses every character of the alphabet, and none that misreads", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (const character of newUserKey("secret").slice(3)) {
        if (character !== "-") seen.add(character);
      }
    }
    expect(seen.size).toBe(31);
    for (const misread of "01ILO") expect(seen.has(misread)).toBe(false);
  });
});

describe("parseUserKey", () => {
  const key = "SK-2345-6789-ABCD-EFGH-JKMN-PQRS-TUVW";

  it("reads a key back however it was typed", () => {
    expect(parseUserKey(key, "secret")).toBe(key);
    expect(parseUserKey(key.toLowerCase(), "secret")).toBe(key);
    expect(parseUserKey(key.replace(/-/g, " "), "secret")).toBe(key);
    expect(parseUserKey(key.replace(/-/g, ""), "secret")).toBe(key);
    expect(parseUserKey(`  ${key}\n`, "secret")).toBe(key);
  });

  it("reads one typed without its prefix", () => {
    expect(parseUserKey(key.slice(3), "secret")).toBe(key);
    expect(parseUserKey(key.slice(3), "recovery")).toBe(`RK${key.slice(2)}`);
  });

  it("refuses the other kind of key", () => {
    expect(parseUserKey(key, "recovery")).toBeNull();
    expect(parseUserKey(`RK${key.slice(2)}`, "secret")).toBeNull();
  });

  it("refuses what cannot be a key", () => {
    expect(parseUserKey("", "secret")).toBeNull();
    expect(parseUserKey(key.slice(0, -1), "secret")).toBeNull();
    expect(parseUserKey(`${key}2`, "secret")).toBeNull();
    expect(parseUserKey(key.replace("2", "0"), "secret")).toBeNull();
    expect(parseUserKey(key.replace("A", "I"), "secret")).toBeNull();
  });

  it("reads back every key it makes", () => {
    for (const kind of ["secret", "recovery"] as const) {
      const made = newUserKey(kind);
      expect(parseUserKey(made, kind)).toBe(made);
    }
  });
});

describe("userKeyKindOf", () => {
  it("tells the two keys apart by their prefix", () => {
    expect(userKeyKindOf(newUserKey("secret"))).toBe("secret");
    expect(userKeyKindOf(newUserKey("recovery").toLowerCase())).toBe(
      "recovery",
    );
    expect(userKeyKindOf(newUserKey("secret").slice(3))).toBeNull();
    expect(userKeyKindOf("hello")).toBeNull();
  });
});
