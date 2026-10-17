import { describe, expect, it } from "vitest";
import { PREF_PARSERS } from "./prefParsers.ts";

describe("PREF_PARSERS", () => {
  it.each(["__proto__", "toString", "constructor"])(
    "reads %s as no board colour, texture or gradient",
    (name) => {
      expect(PREF_PARSERS.boardColor(name)).toBe("none");
      expect(PREF_PARSERS.boardGradient(name)).toBe("none");
      expect(PREF_PARSERS.boardTexture(name)).toBe("none");
    },
  );
});
