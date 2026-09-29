import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signDelivery } from "./dispatcher.js";

/**
 * The signature is public surface: every receiver recomputes it from the
 * spec (docs/specification/features/webhooks.md), not from this code. These
 * check it against that description, written out as a receiver would.
 */

/** A receiver's check, as the spec tells one to write it. */
function receiverAccepts(
  secret: string,
  headers: { timestamp: string; signature: string },
  body: string,
): boolean {
  const expected = `sha256=${createHmac("sha256", secret)
    .update(`${headers.timestamp}.${body}`, "utf8")
    .digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(headers.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const SECRET = "whsec_test";
const BODY = JSON.stringify({ event: "note.updated", note: { title: "Ää" } });

describe("signDelivery", () => {
  it("is the hex HMAC-SHA256 of the timestamp, a dot and the body, after sha256=", () => {
    const signature = signDelivery(SECRET, "1767225600", BODY);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(
      receiverAccepts(SECRET, { timestamp: "1767225600", signature }, BODY),
    ).toBe(true);
  });

  it("matches a known vector, so the scheme cannot drift unnoticed", () => {
    expect(signDelivery("key", "1", "{}")).toBe(
      `sha256=${createHmac("sha256", "key").update("1.{}").digest("hex")}`,
    );
  });

  it("fails a receiver's check when the body, the timestamp or the secret differ", () => {
    const signature = signDelivery(SECRET, "1767225600", BODY);
    expect(
      receiverAccepts(
        SECRET,
        { timestamp: "1767225600", signature },
        BODY.replace("Ää", "Aa"),
      ),
    ).toBe(false);
    // A captured delivery replayed with a fresh timestamp.
    expect(
      receiverAccepts(SECRET, { timestamp: "1767225601", signature }, BODY),
    ).toBe(false);
    expect(
      receiverAccepts(
        "whsec_other",
        { timestamp: "1767225600", signature },
        BODY,
      ),
    ).toBe(false);
  });
});
