import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { ServerConfig } from "../config.js";

export function corsMiddleware(cfg: ServerConfig): MiddlewareHandler {
  const origins = cfg.corsOrigins;
  return cors({
    origin: (incoming) => {
      if (!incoming) return null;
      return origins.includes(incoming) ? incoming : null;
    },
    // `If-Match` carries the optimistic-concurrency token on every update of
    // a note the client already holds; without it here the browser refuses
    // the request before it is sent.
    allowHeaders: ["Authorization", "Content-Type", "If-Match"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: false,
    maxAge: 600,
  });
}
