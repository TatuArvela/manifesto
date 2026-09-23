import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226), the six-digit codes
 * authenticator apps show, with the parameters every one of them defaults to:
 * SHA-1, six digits, thirty-second steps. Written out rather than taken from
 * a library because it is forty lines of HMAC and arithmetic, and the tests
 * hold it to the RFC's own vectors.
 */

export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;
/** Steps either side of now a code is accepted from, for clock drift. */
const WINDOW = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("Not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 bits, as RFC 4226 recommends, in the base32 the apps take. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * The step `code` belongs to, within the window around `nowMs`, or null. The
 * caller stores the step and refuses any code from it or before, so a code
 * seen over someone's shoulder cannot be used a second time.
 */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs: number,
): number | null {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const key = base32Decode(secret);
  const now = totpStep(nowMs);
  for (let step = now - WINDOW; step <= now + WINDOW; step++) {
    const expected = Buffer.from(hotp(key, step));
    if (timingSafeEqual(expected, Buffer.from(digits))) return step;
  }
  return null;
}

/** What an authenticator app scans (or opens, tapped on a phone). */
export function otpauthUri(
  issuer: string,
  account: string,
  secret: string,
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}

/**
 * One-time recovery codes, for when the authenticator is lost: ten groups of
 * four, from an alphabet with no look-alike characters. Stored hashed.
 */
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const chars = [...bytes].map(
      (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length],
    );
    return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
  });
}

/** A recovery code as typed: case and separators do not matter. */
export function normalizeRecoveryCode(code: string): string {
  const bare = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  return bare.length === 8 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : bare;
}
