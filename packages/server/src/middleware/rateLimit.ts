import type { MiddlewareHandler } from "hono";
import { createExpiringCounter } from "../lib/expiringCounter.js";
import { countMetric } from "../lib/metrics.js";
import { HttpError } from "./error.js";

export interface RateLimitOptions {
  /** Maximum requests allowed per key within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Build a string key from the request, usually the source IP. */
  keyFor?: (c: Parameters<MiddlewareHandler>[0]) => string;
  /** Honor `X-Forwarded-For` (set this when behind a trusted reverse proxy).
   * Defaults to false; without it, an attacker can rotate the header to
   * bypass per-IP throttling. */
  trustProxy?: boolean;
  /** Names the limiter in the rate-limit metric. */
  name?: string;
}

/**
 * Live buckets one limiter will hold. Past this, the oldest are evicted (see
 * `createExpiringCounter`). Sized well above any plausible honest load: the
 * per-user limiter would need this many accounts active within a minute, and
 * the per-IP one this many distinct networks within fifteen.
 */
const MAX_BUCKETS = 50_000;

function socketAddress(c: Parameters<MiddlewareHandler>[0]): string {
  // Hono on Node: fall back to the underlying socket peer address.
  // biome-ignore lint/suspicious/noExplicitAny: env shape is platform-specific
  const incoming = (c.env as any)?.incoming;
  return incoming?.socket?.remoteAddress ?? "anon";
}

/** The four bytes of a dotted-quad IPv4 address, or null. */
function ipv4Bytes(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const byte = Number.parseInt(part, 10);
    if (byte > 255) return null;
    bytes.push(byte);
  }
  return bytes;
}

/** One side of a `::` as 16-bit groups, or null if any part is not one. */
function expandGroups(half: string): number[] | null {
  if (half === "") return [];
  const parts = half.split(":");
  const groups: number[] = [];
  for (const [i, part] of parts.entries()) {
    if (part.includes(".")) {
      // An embedded IPv4 fills the last two groups, so it can only come last.
      const bytes = i === parts.length - 1 ? ipv4Bytes(part) : null;
      if (!bytes) return null;
      groups.push((bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}

/**
 * The eight 16-bit groups of an IPv6 address, or null if it is not one.
 * Written-out and abbreviated forms of one address have to come back the
 * same, or `2001:db8::1` and `2001:0db8:0000:0000:0:0:0:1` would be keyed as
 * two networks.
 */
function ipv6Groups(address: string): number[] | null {
  // A link-local address carries the interface it arrived on. That names a
  // route, not a network, so it is not part of the key.
  const zone = address.indexOf("%");
  const bare = zone === -1 ? address : address.slice(0, zone);
  if (!bare.includes(":")) return null;
  const halves = bare.split("::");
  if (halves.length > 2) return null;
  const head = expandGroups(halves[0]);
  const tail = halves.length === 2 ? expandGroups(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const gap = 8 - head.length - tail.length;
  // `::` stands for at least one group of zeros.
  if (gap < 1) return null;
  return [...head, ...Array<number>(gap).fill(0), ...tail];
}

/** `::ffff:a.b.c.d`: an IPv4 client reaching a dual-stack listener. */
function isIpv4Mapped(groups: number[]): boolean {
  return (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  );
}

function ipv4String(groups: number[]): string {
  const bytes = [
    groups[6] >> 8,
    groups[6] & 0xff,
    groups[7] >> 8,
    groups[7] & 0xff,
  ];
  return bytes.join(".");
}

/**
 * The bucket key for a client address.
 *
 * IPv6 is keyed on its /64 rather than on the whole address. A /64 is the
 * smallest block anyone is handed, so keying the /128 gives a single client
 * with a routed prefix 2^64 buckets to rotate through and no per-address
 * limit means anything. That matters most on `/api/auth/login`, where one
 * cheap request buys the server a ~19 MiB argon2 verify.
 *
 * IPv4 is a host address already and is keyed whole. An IPv4 client reaching
 * a dual-stack listener arrives as `::ffff:a.b.c.d`, so the mapped form is
 * unwrapped to the same key it gets when it arrives unmapped: taking the
 * first four hextets of *that* would file every IPv4 client on the internet
 * into one shared bucket.
 *
 * Anything that does not parse as an address (a proxy's `unknown`, the `anon`
 * fallback) keys as itself.
 */
export function ipBucketKey(address: string): string {
  const groups = ipv6Groups(address);
  if (!groups) return address;
  if (isIpv4Mapped(groups)) return ipv4String(groups);
  const prefix = groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":");
  return `${prefix}::/64`;
}

/**
 * The client's address as the server sees it: the first `X-Forwarded-For`
 * hop behind a trusted proxy, else the socket peer. Unbucketed, for the
 * audit log to show.
 */
export function clientAddress(
  c: Parameters<MiddlewareHandler>[0],
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const fwd = c.req.header("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
  }
  return socketAddress(c);
}

function makeDefaultKey(
  trustProxy: boolean,
): (c: Parameters<MiddlewareHandler>[0]) => string {
  if (!trustProxy) return (c) => ipBucketKey(socketAddress(c));
  return (c) => {
    const fwd = c.req.header("x-forwarded-for");
    if (fwd) return ipBucketKey(fwd.split(",")[0].trim());
    return ipBucketKey(socketAddress(c));
  };
}

/**
 * Per-authenticated-user limiter for /api/notes and /api/search. The bucket
 * key is the userId set by `createAuthMiddleware`, so this MUST be mounted
 * AFTER auth. 300 requests/minute is generous for normal use and catches
 * runaway clients / misuse without paging legitimate users.
 */
export function perUserApiRateLimit(limit = 300): MiddlewareHandler<{
  Variables: { auth: { userId: string } };
}> {
  return rateLimit({
    limit,
    windowMs: 60 * 1000,
    keyFor: (c) => `user:${c.get("auth").userId}`,
    name: "per-user",
  });
}

/**
 * Tiny in-memory rate limiter. Single-process only; when this app outgrows
 * one node, swap the buckets for a Redis-backed implementation.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = createExpiringCounter({
    windowMs: opts.windowMs,
    maxEntries: MAX_BUCKETS,
  });
  const keyFor = opts.keyFor ?? makeDefaultKey(opts.trustProxy ?? false);
  return async (c, next) => {
    const now = Date.now();
    const { count, resetAt } = buckets.hit(keyFor(c), now);
    if (count > opts.limit) {
      countMetric(
        "manifesto_rate_limited_total",
        "Requests refused by a rate limit.",
        { limiter: opts.name ?? "api" },
      );
      const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      throw new HttpError(429, "Too many requests");
    }
    await next();
  };
}
