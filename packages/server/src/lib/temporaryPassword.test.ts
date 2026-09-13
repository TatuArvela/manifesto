import { describe, expect, it } from "vitest";
import { newTemporaryPassword } from "./temporaryPassword.js";

describe("newTemporaryPassword", () => {
  it("is four groups of four, with nothing that reads as another character", () => {
    for (let i = 0; i < 200; i++) {
      const password = newTemporaryPassword();
      expect(password).toMatch(/^([a-z2-9]{4}-){3}[a-z2-9]{4}$/);
      expect(password).not.toMatch(/[01ilo]/);
    }
  });

  it("clears the minimum password length it is checked against at sign-in", () => {
    expect(newTemporaryPassword().length).toBeGreaterThanOrEqual(8);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 1000 }, newTemporaryPassword));
    expect(seen.size).toBe(1000);
  });
});
