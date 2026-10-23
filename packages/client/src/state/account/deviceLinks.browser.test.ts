import { afterEach, describe, expect, it, vi } from "vitest";

const held: string[] = [];

vi.mock("./accountKeys.ts", () => ({
  holdScannedSecretKey: (raw: string) => held.push(raw),
  revealSecretKey: async () => ({ kind: "failed" }),
}));

const { deviceLinkAddress, takeDeviceLinkToken } = await import(
  "./deviceLinks.ts"
);

const TOKEN = "ab".repeat(32);
const KEY = "SK-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ";

describe("the address of a device code", () => {
  afterEach(() => {
    held.length = 0;
    history.replaceState(null, "", window.location.pathname);
  });

  it("carries the token, and the key only when there is one", () => {
    expect(deviceLinkAddress(TOKEN, null)).toMatch(
      new RegExp(`#device=${TOKEN}$`),
    );
    expect(deviceLinkAddress(TOKEN, KEY)).toMatch(
      new RegExp(`#device=${TOKEN}&key=${KEY}$`),
    );
  });

  it("takes the token and the key, and clears the address", () => {
    location.hash = `device=${TOKEN}&key=${KEY}`;
    expect(takeDeviceLinkToken()).toBe(TOKEN);
    expect(held).toEqual([KEY]);
    expect(location.hash).toBe("");
    expect(takeDeviceLinkToken()).toBeNull();
  });

  it("takes a code without a key", () => {
    location.hash = `device=${TOKEN}`;
    expect(takeDeviceLinkToken()).toBe(TOKEN);
    expect(held).toEqual([]);
  });

  it("does not keep the key for a person already signed in", () => {
    location.hash = `device=${TOKEN}&key=${KEY}`;
    expect(takeDeviceLinkToken({ holdKey: false })).toBe(TOKEN);
    expect(held).toEqual([]);
    expect(location.hash).toBe("");
  });

  it("leaves other fragments alone", () => {
    location.hash = `signin=${TOKEN}`;
    expect(takeDeviceLinkToken()).toBeNull();
    expect(location.hash).toBe(`#signin=${TOKEN}`);
  });
});
