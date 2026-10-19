import type { MiddlewareHandler } from "hono";
import { logger } from "#/lib/logger.ts";

/**
 * A structured access log.
 *
 * It replaces `hono/logger`. That logger builds its line from `c.req.url`, cut
 * at the first path separator. Thus, it puts the query string into the log at
 * the default level. That string contains note content on `/api/v1/search?q=`,
 * and a single-use OIDC authorization code on `/api/v1/auth/callback?code=`.
 * Neither belongs in output that an operator can read. `c.req.path` is the same
 * value without the query, and Hono has no option to make its own logger use
 * it.
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
