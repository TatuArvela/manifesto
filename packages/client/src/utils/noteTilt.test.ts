import { ulid } from "ulid";
import { describe, expect, it } from "vitest";
import { noteTilt } from "./noteTilt.ts";

describe("noteTilt", () => {
  const ids = Array.from({ length: 200 }, () => ulid());

  it("leans every note between half a degree and two, either way", () => {
    for (const id of ids) {
      const tilt = Math.abs(noteTilt(id));
      expect(tilt).toBeGreaterThanOrEqual(0.5);
      expect(tilt).toBeLessThanOrEqual(2);
    }
  });

  it("gives a note the same lean every time", () => {
    for (const id of ids) expect(noteTilt(id)).toBe(noteTilt(id));
  });

  it("leans notes made together both ways", () => {
    const signs = new Set(ids.map((id) => Math.sign(noteTilt(id))));
    expect(signs).toEqual(new Set([-1, 1]));
  });
});
