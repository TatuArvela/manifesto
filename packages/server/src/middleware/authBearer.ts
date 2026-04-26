import type { MiddlewareHandler } from "hono";
import type { ServerConfig } from "../config.js";
import type { SessionsRepo } from "../db/repositories/sessions.js";
import { isoPlusDays, nowIso } from "../lib/time.js";
import { HttpError } from "./error.js";

export interface AuthContext {
  userId: string;
  token: string;
}

const BEARER_PREFIX = "Bearer ";

export function createAuthMiddleware(
  sessionsRepo: SessionsRepo,
  cfg: ServerConfig,
): MiddlewareHandler<{ Variables: { auth: AuthContext } }> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith(BEARER_PREFIX)) {
      throw new HttpError(401, "Missing bearer token");
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    if (token.length === 0) {
      throw new HttpError(401, "Empty bearer token");
    }
    const session = await sessionsRepo.findByToken(token);
    if (!session) {
      throw new HttpError(401, "Invalid session");
    }
    const now = nowIso();
    if (session.expires_at < now) {
      await sessionsRepo.deleteByToken(token);
      throw new HttpError(401, "Session expired");
    }
    const newExpiry = isoPlusDays(cfg.sessionTtlDays);
    await sessionsRepo.touch(token, now, newExpiry);
    c.set("auth", { userId: session.user_id, token });
    await next();
  };
}
