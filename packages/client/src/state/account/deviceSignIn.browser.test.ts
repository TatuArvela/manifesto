import { deviceMatchCode, newDeviceRequestKeys } from "@manifesto/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls: { path: string; body: unknown }[] = [];

vi.mock("#/storage/apiRequest.ts", () => ({
  apiFetch: async (_method: string, path: string, body: unknown) => {
    calls.push({ path, body });
    return new Response(null, { status: 204 });
  },
}));

vi.mock("./accountKeys.ts", () => ({
  holdScannedSecretKey: () => {},
  revealSecretKey: async () => ({
    kind: "ok",
    secretKey: "SK-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ",
  }),
}));

const {
  approveDeviceSignIn,
  scannedDeviceRequest,
  takeDeviceRequestFromAddress,
} = await import("./deviceSignIn.ts");

const ID = "ab".repeat(32);

describe("the approval of a scanned device code", () => {
  afterEach(() => {
    calls.length = 0;
    scannedDeviceRequest.value = null;
    history.replaceState(null, "", window.location.pathname);
  });

  it("takes the request from the address, and clears it", async () => {
    const { publicKey } = await newDeviceRequestKeys();
    location.hash = `approve=${ID}&pk=${publicKey}`;
    takeDeviceRequestFromAddress();
    expect(scannedDeviceRequest.value).toEqual({ id: ID, publicKey });
    expect(location.hash).toBe("");
  });

  it("leaves an address that is not a request alone", () => {
    location.hash = `approve=${ID}&pk=short`;
    takeDeviceRequestFromAddress();
    expect(scannedDeviceRequest.value).toBeNull();
  });

  it("sends nothing when the typed code is wrong", async () => {
    const { publicKey } = await newDeviceRequestKeys();
    const code = await deviceMatchCode(ID, publicKey);
    const wrong = code === "000 000" ? "111111" : "000000";
    const result = await approveDeviceSignIn(
      { id: ID, publicKey },
      wrong,
      "pw",
    );
    expect(result).toEqual({ kind: "wrongCode" });
    expect(calls).toEqual([]);
  });

  it("sends the key wrapped to the code's public key when the code matches", async () => {
    const { publicKey } = await newDeviceRequestKeys();
    const code = await deviceMatchCode(ID, publicKey);
    const result = await approveDeviceSignIn({ id: ID, publicKey }, code, "pw");
    expect(result).toEqual({ kind: "ok" });
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as { id: string; key: { wrapped: string } };
    expect(body.id).toBe(ID);
    expect(body.key.wrapped).not.toContain("SK-");
  });
});
