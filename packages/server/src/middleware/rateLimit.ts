import type { MiddlewareHandler } from "hono";
import { createExpiringCounter } from "#/lib/expiringCounter.ts";
import { countMetric } from "#/lib/metrics.ts";
import { HttpError } from "./error.ts";

export interface RateLimitOptions {
  /** The maximum number of requests for each key within the window. */
  limit: number;
  /** The window length in milliseconds. */
  windowMs: number;
  /** Build a string key from the request, usually the source IP. */
  keyFor?: (c: Parameters<MiddlewareHandler>[0]) => string;
  /**
   * Use `X-Forwarded-For` (set this behind a trusted reverse proxy). The
   * default is false. Without it, an attacker can change the header to go
   * around the throttle for each IP.
   */
  trustProxy?: boolean;
  /** Names the limiter in the rate-limit metric. */
  name?: string;
}

/**
 * The live buckets that one limiter keeps. After this, the oldest go (see
 * `createExpiringCounter`). The size is much more than all likely honest load.
 * The limiter for each user would need this many active accounts within one
 * minute, and the limiter for each IP this many different networks within
 * fifteen minutes.
 */
const MAX_BUCKETS = 50_000;

function socketAddress(c: Parameters<MiddlewareHandler>[0]): string {
  // Hono on Node: use the peer address of the socket.
  // biome-ignore lint/suspicious/noExplicitAny: env shape is platform-specific
  const incoming = (c.env as any)?.incoming;
  return incoming?.socket?.remoteAddress ?? "anon";
}

type Ipv4Bytes = [number, number, number, number];
type Ipv6Groups = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** The four bytes of a dotted-quad IPv4 address, or null. */
function ipv4Bytes(text: string): Ipv4Bytes | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const byte = Number.parseInt(part, 10);
    if (byte > 255) return null;
    bytes.push(byte);
  }
  return bytes as Ipv4Bytes;
}

/** One side of a `::` as 16-bit groups, or null if a part is not one. */
function expandGroups(half: string): number[] | null {
  if (half === "") return [];
  const parts = half.split(":");
  const groups: number[] = [];
  for (const [i, part] of parts.entries()) {
    if (part.includes(".")) {
      // An embedded IPv4 fills the last two groups. Thus, it can only come
      // last.
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
 * The eight 16-bit groups of an IPv6 address, or null if it is not one. The
 * full form and the short form of one address must give the same result. If
 * not, `2001:db8::1` and `2001:0db8:0000:0000:0:0:0:1` would be two networks.
 */
function ipv6Groups(address: string): Ipv6Groups | null {
  // A link-local address contains the interface on which it arrived. That names
  // a route, not a network. Thus, it is not part of the key.
  const zone = address.indexOf("%");
  const bare = zone === -1 ? address : address.slice(0, zone);
  if (!bare.includes(":")) return null;
  const [headPart = "", tailPart, ...rest] = bare.split("::");
  if (rest.length > 0) return null;
  const head = expandGroups(headPart);
  const tail = tailPart === undefined ? [] : expandGroups(tailPart);
  if (!head || !tail) return null;
  if (tailPart === undefined) return eightGroups(head);
  const gap = 8 - head.length - tail.length;
  // `::` means one or more groups of zeros.
  if (gap < 1) return null;
  return eightGroups([...head, ...Array<number>(gap).fill(0), ...tail]);
}

function eightGroups(groups: number[]): Ipv6Groups | null {
  return groups.length === 8 ? (groups as Ipv6Groups) : null;
}

/** `::ffff:a.b.c.d`: an IPv4 client that reaches a dual-stack listener. */
function isIpv4Mapped(groups: Ipv6Groups): boolean {
  return (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  );
}

function ipv4String(groups: Ipv6Groups): string {
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
 * For IPv6, the key is its /64, not the full address. A /64 is the smallest
 * block that a subscriber gets. If the key were the /128, one client with a
 * routed prefix would have 2^64 buckets to use, and no limit for each address
 * would have a meaning. This is most important on `/api/v1/auth/login`, where
 * one cheap request costs the server an argon2 verification of approximately 19
 * MiB.
 *
 * IPv4 is already a host address, and the key is the full address. An IPv4
 * client that reaches a dual-stack listener arrives as `::ffff:a.b.c.d`. Thus,
 * the code unwraps the mapped form to the same key that it gets without the
 * mapping. If the code took the first four hextets of *that* form, it would put
 * all IPv4 clients on the internet into one shared bucket.
 *
 * All values that do not parse as an address (the `unknown` of a proxy, the
 * `anon` fallback) are their own key.
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
 * The address of the client as the server sees it: the first `X-Forwarded-For`
 * hop behind a trusted proxy, or the socket peer. Not in buckets, for the audit
 * log.
 */
export function clientAddress(
  c: Parameters<MiddlewareHandler>[0],
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const fwd = c.req.header("x-forwarded-for");
    if (fwd) return firstHop(fwd);
  }
  return socketAddress(c);
}

/** The own entry of the client in an `X-Forwarded-For` list. */
function firstHop(forwardedFor: string): string {
  const [first = ""] = forwardedFor.split(",");
  return first.trim();
}

function makeDefaultKey(
  trustProxy: boolean,
): (c: Parameters<MiddlewareHandler>[0]) => string {
  if (!trustProxy) return (c) => ipBucketKey(socketAddress(c));
  return (c) => {
    const fwd = c.req.header("x-forwarded-for");
    if (fwd) return ipBucketKey(firstHop(fwd));
    return ipBucketKey(socketAddress(c));
  };
}

/**
 * A limiter for each authenticated user, for /api/v1/notes and /api/v1/search.
 * The bucket key is the userId that `createAuthMiddleware` sets. Thus, you MUST
 * mount this AFTER auth. 300 requests each minute is generous for usual use. It
 * stops clients that are out of control, and misuse, without problems for
 * legitimate users.
 */
export function perUserApiRateLimit(
  limit = 300,
  name = "per-user",
): MiddlewareHandler<{
  Variables: { auth: { userId: string } };
}> {
  return rateLimit({
    limit,
    windowMs: 60 * 1000,
    keyFor: (c) => `user:${c.get("auth").userId}`,
    name,
  });
}

/**
 * A small rate limiter in memory, only for one process. When this app needs
 * more than one node, replace the buckets with an implementation on Redis.
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
