import type { MiddlewareHandler } from "hono";
import { HttpError } from "./error.js";

export interface RateLimitOptions {
  /** Maximum requests allowed per key within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Build a string key from the request — usually the source IP. */
  keyFor?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

function defaultKey(c: Parameters<MiddlewareHandler>[0]): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  // Hono on Node — fall back to the underlying socket peer address.
  // biome-ignore lint/suspicious/noExplicitAny: env shape is platform-specific
  const incoming = (c.env as any)?.incoming;
  return incoming?.socket?.remoteAddress ?? "anon";
}

/**
 * Tiny in-memory rate limiter. Single-process only — when this app outgrows
 * one node, swap the buckets for a Redis-backed implementation.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const keyFor = opts.keyFor ?? defaultKey;
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
