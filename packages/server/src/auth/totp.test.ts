import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  hotp,
  newRecoveryCodes,
  normalizeRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "./totp.js";

// RFC 4226 appendix D and RFC 6238 appendix B use this ASCII key.
const KEY = Buffer.from("12345678901234567890");

describe("hotp", () => {
  it("matches the RFC 4226 test values", () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(KEY, c))).toEqual([
      "755224",
      "287082",
      "359152",
      "969429",
      "520489",
    ]);
  });

  it("matches RFC 6238's SHA-1 values for eight digits", () => {
    expect(hotp(KEY, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(hotp(KEY, Math.floor(1111111109 / 30), 8)).toBe("07081804");
  });
});

describe("base32", () => {
  it("round-trips and reads what authenticator apps show", () => {
    const encoded = base32Encode(KEY);
    expect(encoded).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(
      base32Decode(encoded.toLowerCase().match(/.{4}/g)?.join(" ") ?? ""),
    ).toEqual(KEY);
  });
});

describe("verifyTotp", () => {
  const secret = base32Encode(KEY);
  const at = 1111111109 * 1000;

  it("accepts the current code and one step either side", () => {
    const step = Math.floor(1111111109 / 30);
    expect(verifyTotp(secret, hotp(KEY, step), at)).toBe(step);
    expect(verifyTotp(secret, hotp(KEY, step - 1), at)).toBe(step - 1);
    expect(verifyTotp(secret, hotp(KEY, step + 1), at)).toBe(step + 1);
    expect(verifyTotp(secret, hotp(KEY, step + 2), at)).toBeNull();
  });

  it("refuses anything but six digits", () => {
    expect(verifyTotp(secret, "12345", at)).toBeNull();
    expect(verifyTotp(secret, "abcdef", at)).toBeNull();
  });
});

describe("recovery codes", () => {
  it("are distinct, and read regardless of case and separators", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(
      normalizeRecoveryCode(codes[0].toUpperCase().replace("-", " ")),
    ).toBe(codes[0]);
  });
});

describe("otpauthUri", () => {
  it("names the issuer and account", () => {
    expect(otpauthUri("Notes", "alice", "ABC")).toBe(
      "otpauth://totp/Notes:alice?secret=ABC&issuer=Notes&algorithm=SHA1&digits=6&period=30",
    );
  });
});
