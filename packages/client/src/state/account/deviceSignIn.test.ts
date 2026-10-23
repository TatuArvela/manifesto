import {
  deviceMatchCode,
  newDeviceRequestKeys,
  openOnDevice,
  wrapForDevice,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";

const ID = "ab".repeat(32);
const OTHER_ID = "cd".repeat(32);
const SECRET_KEY = "SK-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ";

describe("the key exchange of a device sign-in", () => {
  it("opens the secret key on the device that made the request", async () => {
    const keys = await newDeviceRequestKeys();
    const wrapped = await wrapForDevice(ID, keys.publicKey, SECRET_KEY);
    expect(wrapped.wrapped).not.toContain(SECRET_KEY);
    expect(await openOnDevice(ID, keys.privateKey, wrapped)).toBe(SECRET_KEY);
  });

  it("does not open for a different request or a different device", async () => {
    const keys = await newDeviceRequestKeys();
    const other = await newDeviceRequestKeys();
    const wrapped = await wrapForDevice(ID, keys.publicKey, SECRET_KEY);
    expect(await openOnDevice(OTHER_ID, keys.privateKey, wrapped)).toBeNull();
    expect(await openOnDevice(ID, other.privateKey, wrapped)).toBeNull();
    expect(
      await openOnDevice(ID, keys.privateKey, { ...wrapped, wrapped: "junk" }),
    ).toBeNull();
  });

  it("refuses to wrap to a value that is not a public key", async () => {
    await expect(wrapForDevice(ID, "not-a-key", SECRET_KEY)).rejects.toThrow();
  });

  it("makes the same six digits from the same code, and others from another", async () => {
    const keys = await newDeviceRequestKeys();
    const code = await deviceMatchCode(ID, keys.publicKey);
    expect(code).toMatch(/^\d{3} \d{3}$/);
    expect(await deviceMatchCode(ID, keys.publicKey)).toBe(code);
    const other = await newDeviceRequestKeys();
    const others = await Promise.all(
      [OTHER_ID, ID].map((id, i) =>
        deviceMatchCode(id, i === 0 ? keys.publicKey : other.publicKey),
      ),
    );
    // Two random codes are the same one time in a million.
    expect(others).not.toContain(code);
  });
});
