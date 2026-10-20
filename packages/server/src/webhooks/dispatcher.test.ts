import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signDelivery } from "./dispatcher.ts";

/**
 * The signature is public surface. Each receiver calculates it again from the
 * specification (docs/specification/features/webhooks.md), not from this code.
 * These tests check it against that description, written as a receiver would
 * write it.
 */

/** The check of a receiver, as the specification tells you to write it. */
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
    // A captured delivery, sent again with a new timestamp.
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
