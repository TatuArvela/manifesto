import type { MiddlewareHandler } from "hono";
import { logger } from "../lib/logger.js";

/**
 * Structured access log.
 *
 * Replaces `hono/logger`, which builds its line from `c.req.url` sliced at the
 * first path separator and therefore carries the query string into the log at
 * the default level. That string holds note content on `/api/search?q=` and a
 * single-use OIDC authorization code on `/api/auth/callback?code=`, neither of
 * which belongs in operator-readable output. `c.req.path` is the same value
 * with the query removed, and Hono exposes no option to make its own logger
 * use it.
 */
export function requestLog(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    await next();
    logger.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    });
  };
}
