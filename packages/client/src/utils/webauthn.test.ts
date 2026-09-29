import { describe, expect, it } from "vitest";
import {
  base64urlToBytes,
  bytesToBase64url,
  creationOptionsFromJSON,
  requestOptionsFromJSON,
} from "./webauthn.js";

describe("passkey JSON", () => {
  it("turns base64url into bytes and back, padding and all", () => {
    for (const length of [0, 1, 2, 3, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 251) % 256);
      const text = bytesToBase64url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(base64urlToBytes(text)).toEqual(bytes);
    }
  });

  it("gives the browser bytes where WebAuthn wants them", () => {
    const creation = creationOptionsFromJSON({
      challenge: "AQID",
      rp: { id: "notes.example", name: "notes.example" },
      user: { id: "BAU", name: "alice", displayName: "Alice" },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      excludeCredentials: [
        { id: "Bgc", type: "public-key", transports: ["internal"] },
      ],
    });
    expect(creation.challenge).toEqual(Uint8Array.from([1, 2, 3]));
    expect(creation.user.id).toEqual(Uint8Array.from([4, 5]));
    expect(creation.excludeCredentials?.[0]).toEqual({
      type: "public-key",
      id: Uint8Array.from([6, 7]),
      transports: ["internal"],
    });
    expect(creation.rp).toEqual({ id: "notes.example", name: "notes.example" });

    const request = requestOptionsFromJSON({
      challenge: "CAk",
      allowCredentials: [{ id: "Cg", type: "public-key" }],
      userVerification: "required",
    });
    expect(request.challenge).toEqual(Uint8Array.from([8, 9]));
    expect(request.allowCredentials?.[0]?.id).toEqual(Uint8Array.from([10]));
    expect(request.userVerification).toBe("required");
  });
});
