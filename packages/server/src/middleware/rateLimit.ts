import type { MiddlewareHandler } from "hono";
import { HttpError } from "./error.js";

export interface RateLimitOptions {
  /** Maximum requests allowed per key within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Build a string key from the request — usually the source IP. */
  keyFor?: (c: Parameters<MiddlewareHandler>[0]) => string;
  /** Honor `X-Forwarded-For` (set this when behind a trusted reverse proxy).
   * Defaults to false — without it, an attacker can rotate the header to
   * bypass per-IP throttling. */
  trustProxy?: boolean;
}

interface Bucket {
  count: number;
  resetAt: number;
}

function socketAddress(c: Parameters<MiddlewareHandler>[0]): string {
  // Hono on Node — fall back to the underlying socket peer address.
  // biome-ignore lint/suspicious/noExplicitAny: env shape is platform-specific
  const incoming = (c.env as any)?.incoming;
  return incoming?.socket?.remoteAddress ?? "anon";
}

function makeDefaultKey(
  trustProxy: boolean,
): (c: Parameters<MiddlewareHandler>[0]) => string {
  if (!trustProxy) return socketAddress;
  return (c) => {
    const fwd = c.req.header("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    return socketAddress(c);
  };
}

/**
 * Tiny in-memory rate limiter. Single-process only — when this app outgrows
 * one node, swap the buckets for a Redis-backed implementation.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const keyFor = opts.keyFor ?? makeDefaultKey(opts.trustProxy ?? false);
  return async (c, next) => {
    const now = Date.now();
    const key = keyFor(c);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > opts.limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      throw new HttpError(429, "Too many requests");
    }
    await next();
  };
}
